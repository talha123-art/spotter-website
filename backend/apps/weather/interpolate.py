"""Hourly forecast interpolation at an arbitrary instant (pure)."""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import datetime

VARS = ("wind_mph", "gust_mph", "rain_in", "snow_in", "precip_in")


@dataclass
class HourlySeries:
    """Hourly values for one location. ``times`` are unix seconds (UTC), ascending."""

    times: list[int]
    values: dict[str, list[float | None]]
    timezone: str = "UTC"
    utc_offset_s: int = 0
    meta: dict = field(default_factory=dict)


@dataclass(frozen=True)
class WeatherSample:
    wind_mph: float
    gust_mph: float
    rain_in: float
    snow_in: float
    precip_in: float

    def as_dict(self) -> dict[str, float]:
        return {
            "wind_mph": round(self.wind_mph, 1),
            "gust_mph": round(self.gust_mph, 1),
            "rain_in": round(self.rain_in, 2),
            "snow_in": round(self.snow_in, 2),
            "precip_in": round(self.precip_in, 2),
        }


def interpolate_at(series: HourlySeries | None, at: datetime) -> WeatherSample | None:
    """Linear interpolation between the two surrounding hours. Returns None when the
    instant falls outside the forecast range or data is missing ("forecast unavailable")."""
    if series is None or not series.times:
        return None
    ts = at.timestamp()
    times = series.times
    if ts < times[0] or ts > times[-1]:
        return None
    i = bisect_right(times, ts) - 1
    if times[i] == ts or i == len(times) - 1:
        j, t = i, 0.0
    else:
        j = i + 1
        span = times[j] - times[i]
        if span > 3600 * 1.5:  # gap in data
            return None
        t = (ts - times[i]) / span
    out: dict[str, float] = {}
    for var in VARS:
        arr = series.values.get(var)
        if arr is None:
            return None
        a, b = arr[i], arr[j]
        if a is None or b is None:
            return None
        out[var] = max(0.0, a + (b - a) * t)
    return WeatherSample(**out)
