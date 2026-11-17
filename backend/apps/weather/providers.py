"""Weather providers: Open-Meteo (batched, cached per rounded point per UTC day) and a
deterministic mock with configurable storm cells."""

from __future__ import annotations

import json
import logging
import math
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Protocol

import httpx
from django.conf import settings
from django.core.cache import cache

from apps.routing.geo import Coord, haversine_mi
from common.http import UpstreamError, request_json

from .interpolate import VARS, HourlySeries

log = logging.getLogger(__name__)

WX_CACHE_TTL = 30 * 60
ROUND_DEG = 0.05
BATCH_SIZE = 300
HOURLY = "wind_speed_10m,wind_gusts_10m,rain,snowfall,precipitation"
FORECAST_DAYS_AHEAD = 15
CM_TO_IN = 0.393701


def round_point(c: Coord, step: float = ROUND_DEG) -> Coord:
    return (round(round(c[0] / step) * step, 4), round(round(c[1] / step) * step, 4))


def utc_days(start: datetime, end: datetime) -> list[date]:
    d = start.astimezone(UTC).date()
    last = end.astimezone(UTC).date()
    out = []
    while d <= last:
        out.append(d)
        d += timedelta(days=1)
    return out


class WeatherProvider(Protocol):
    name: str

    async def hourly(
        self, client: httpx.AsyncClient, points: list[Coord], start: datetime, end: datetime
    ) -> list[HourlySeries | None]: ...


def _merge_days(day_blobs: list[dict]) -> HourlySeries:
    times: list[int] = []
    vals: dict[str, list[float | None]] = {v: [] for v in VARS}
    tz, off = "UTC", 0
    for blob in day_blobs:
        tz, off = blob["tz"], blob["off"]
        times.extend(blob["t"])
        for v in VARS:
            vals[v].extend(blob[v])
    return HourlySeries(times=times, values=vals, timezone=tz, utc_offset_s=off)


class OpenMeteoProvider:
    name = "open-meteo"

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.OPEN_METEO_BASE_URL).rstrip("/")

    @staticmethod
    def _key(p: Coord, d: date) -> str:
        return f"wx:om:v1:{p[1]:.2f}:{p[0]:.2f}:{d.isoformat()}"

    async def _fetch(self, client: httpx.AsyncClient, pts: list[Coord], days: list[date]) -> dict[str, dict]:
        """Fetch a batch and split it into per-(point, UTC day) cache blobs."""
        start = days[0] - timedelta(days=1)  # dates are interpreted in each point's local tz
        end = days[-1] + timedelta(days=1)
        today = datetime.now(UTC).date()
        start = max(start, today - timedelta(days=2))
        end = min(end, today + timedelta(days=FORECAST_DAYS_AHEAD))
        if end < start:
            return {}
        params = {
            "latitude": ",".join(f"{p[1]:.2f}" for p in pts),
            "longitude": ",".join(f"{p[0]:.2f}" for p in pts),
            "hourly": HOURLY,
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timeformat": "unixtime",
            "timezone": "auto",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        }
        data = await request_json(client, "Open-Meteo", "GET", f"{self.base_url}/v1/forecast", params=params)
        items = data if isinstance(data, list) else [data]
        if len(items) != len(pts):
            raise UpstreamError("Open-Meteo", f"expected {len(pts)} locations, got {len(items)}")
        blobs: dict[str, dict] = {}
        for p, item in zip(pts, items, strict=True):
            h = item.get("hourly") or {}
            units = item.get("hourly_units") or {}
            snow_factor = CM_TO_IN if units.get("snowfall", "inch").startswith("cm") else 1.0
            src = {
                "wind_mph": h.get("wind_speed_10m", []),
                "gust_mph": h.get("wind_gusts_10m", []),
                "rain_in": h.get("rain", []),
                "snow_in": [None if s is None else s * snow_factor for s in h.get("snowfall", [])],
                "precip_in": h.get("precipitation", []),
            }
            by_day: dict[date, dict] = {}
            for i, t in enumerate(h.get("time", [])):
                d = datetime.fromtimestamp(t, UTC).date()
                if d not in days:
                    continue
                b = by_day.setdefault(
                    d, {"tz": item.get("timezone", "UTC"), "off": item.get("utc_offset_seconds", 0), "t": []}
                )
                b["t"].append(int(t))
                for v in VARS:
                    arr = src[v]
                    b.setdefault(v, []).append(arr[i] if i < len(arr) else None)
            for d, b in by_day.items():
                if len(b["t"]) == 24:
                    blobs[self._key(p, d)] = b
        return blobs

    async def hourly(
        self, client: httpx.AsyncClient, points: list[Coord], start: datetime, end: datetime
    ) -> list[HourlySeries | None]:
        import asyncio

        days = utc_days(start, end)
        rpts = [round_point(p) for p in points]
        uniq = list(dict.fromkeys(rpts))
        keys = [self._key(p, d) for p in uniq for d in days]
        found: dict[str, dict] = cache.get_many(keys)
        missing = [p for p in uniq if any(self._key(p, d) not in found for d in days)]
        if missing:
            batches = [missing[i : i + BATCH_SIZE] for i in range(0, len(missing), BATCH_SIZE)]
            results = await asyncio.gather(*(self._fetch(client, b, days) for b in batches))
            fresh: dict[str, dict] = {}
            for r in results:
                fresh.update(r)
            if fresh:
                cache.set_many(fresh, WX_CACHE_TTL)
            found.update(fresh)
        series_by_pt: dict[Coord, HourlySeries | None] = {}
        for p in uniq:
            blobs = [found[self._key(p, d)] for d in days if self._key(p, d) in found]
            series_by_pt[p] = _merge_days(blobs) if blobs else None
        return [series_by_pt[p] for p in rpts]


# --------------------------------------------------------------------------- mock

FIXTURE = Path(__file__).resolve().parent.parent.parent / "fixtures" / "mock_weather.json"


def load_scenario() -> dict:
    with FIXTURE.open(encoding="utf-8") as f:
        return json.load(f)


class MockWeatherProvider:
    """Deterministic weather: calm background + moving Gaussian storm cells defined in
    fixtures/mock_weather.json. Times are relative to ``anchor`` (default: current UTC hour)."""

    name = "mock"

    def __init__(self, anchor: datetime | None = None, scenario: dict | None = None):
        now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        self.anchor = anchor or now
        self.scenario = scenario or load_scenario()

    def sample(self, p: Coord, t: int) -> dict[str, float]:
        hrs = (t - self.anchor.timestamp()) / 3600
        lng, lat = p
        wind = 9 + 5 * math.sin(lat * 1.7 + hrs / 7) * math.cos(lng * 0.9 - hrs / 11)
        rain = max(0.0, 0.03 * math.sin(lng * 2.1 + hrs / 5))
        snow = 0.0
        for s in self.scenario["storms"]:
            if not (s["start_h"] - 6 <= hrs <= s["end_h"] + 6):
                continue
            # ramp in/out over 6 h
            ramp = min(1.0, (hrs - s["start_h"] + 6) / 6, (s["end_h"] + 6 - hrs) / 6)
            c = (s["lng"] + s.get("drift_lng_h", 0) * hrs, s["lat"] + s.get("drift_lat_h", 0) * hrs)
            d = haversine_mi(p, c)
            k = math.exp(-((d / s["radius_mi"]) ** 2)) * max(0.0, ramp)
            wind = max(wind, wind + (s["peak_wind"] - wind) * k)
            rain = max(rain, s.get("peak_rain", 0) * k)
            snow = max(snow, s.get("peak_snow", 0) * k)
        precip = rain + snow / 10
        return {
            "wind_mph": round(max(0.0, wind), 2),
            "gust_mph": round(max(0.0, wind * 1.35 + 3), 2),
            "rain_in": round(rain, 3),
            "snow_in": round(snow, 3),
            "precip_in": round(precip, 3),
        }

    async def hourly(
        self, client: httpx.AsyncClient | None, points: list[Coord], start: datetime, end: datetime
    ) -> list[HourlySeries | None]:
        horizon = self.anchor + timedelta(days=FORECAST_DAYS_AHEAD + 1)
        t0 = start.astimezone(UTC).replace(minute=0, second=0, microsecond=0) - timedelta(hours=1)
        t1 = min(end.astimezone(UTC) + timedelta(hours=2), horizon)
        out: list[HourlySeries | None] = []
        for p in points:
            times = []
            t = t0
            while t <= t1:
                times.append(int(t.timestamp()))
                t += timedelta(hours=1)
            if not times:
                out.append(None)
                continue
            samples = [self.sample(p, ts) for ts in times]
            out.append(
                HourlySeries(
                    times=times,
                    values={v: [s[v] for s in samples] for v in VARS},
                    timezone=_mock_tz(p),
                )
            )
        return out


def _mock_tz(p: Coord) -> str:
    lng = p[0]
    if lng > -87.5:
        return "America/New_York"
    if lng > -101.5:
        return "America/Chicago"
    if lng > -114.5:
        return "America/Denver"
    return "America/Los_Angeles"


def provider_chain() -> list[WeatherProvider]:
    if settings.USE_MOCKS:
        return [MockWeatherProvider()]
    chain: list[WeatherProvider] = [OpenMeteoProvider()]
    if settings.ALLOW_MOCK_FALLBACK:
        chain.append(MockWeatherProvider())
    return chain


async def fetch_hourly(
    client: httpx.AsyncClient, points: list[Coord], start: datetime, end: datetime
) -> tuple[list[HourlySeries | None], str, list[str]]:
    warnings: list[str] = []
    last: UpstreamError | None = None
    for p in provider_chain():
        try:
            series = await p.hourly(client, points, start, end)
            if p.name == "mock" and not settings.USE_MOCKS:
                reason = "rate limited" if last and last.rate_limited else "unavailable"
                warnings.append(
                    f"Live weather (Open-Meteo) is {reason} — showing SIMULATED weather. Do not rely on these risk levels."
                )
            return series, p.name, warnings
        except UpstreamError as exc:
            log.warning("weather provider %s failed: %s", p.name, exc)
            last = exc
    assert last is not None
    raise last
