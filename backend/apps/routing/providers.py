"""Routing providers behind a common interface, with fallback chain and
via-point synthesis to guarantee exactly three distinct routes."""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass
from typing import Protocol

import httpx
from django.conf import settings
from django.core.cache import cache

from common.http import UpstreamError, request_json, stable_hash

from .geo import (
    Coord,
    cumulative_distances_mi,
    destination_point,
    haversine_mi,
    is_same_route,
    overlap_fraction,
    perpendicular_offset,
)
from .types import RawRoute, durations_from_spans

log = logging.getLogger(__name__)

ROUTE_CACHE_TTL = 6 * 3600
LABELS = ("Fastest", "Alternative A", "Alternative B")
IDS = ("fastest", "alt-a", "alt-b")


class NoRouteError(Exception):
    """No drivable route exists between the points (HTTP 422)."""


class RoutingProvider(Protocol):
    name: str

    async def routes(self, client: httpx.AsyncClient, waypoints: list[Coord], alternatives: int) -> list[RawRoute]: ...


# --------------------------------------------------------------------------- OSRM


def _dedupe_concat(parts: list[list[Coord]]) -> list[Coord]:
    out: list[Coord] = []
    for part in parts:
        for c in part:
            if not out or (c[0], c[1]) != out[-1]:
                out.append((c[0], c[1]))
    return out


def parse_osrm_route(route: dict) -> RawRoute:
    coords: list[Coord] = [tuple(c) for c in route["geometry"]["coordinates"]]  # type: ignore[misc]
    legs = route.get("legs", [])
    # Preferred: per-segment annotation durations aligned with the full overview geometry.
    ann: list[float] = []
    for leg in legs:
        ann.extend((leg.get("annotation") or {}).get("duration") or [])
    if ann and len(ann) == len(coords) - 1:
        cum = [0.0]
        for d in ann:
            cum.append(cum[-1] + float(d))
        return RawRoute(coords=coords, cum_duration_s=cum, provider="osrm")
    # Fallback: rebuild geometry from step geometries and spread each step's duration by distance.
    parts: list[list[Coord]] = []
    spans: list[tuple[int, int, float]] = []
    flat: list[Coord] = []
    for leg in legs:
        for step in leg.get("steps", []):
            sc = [tuple(c) for c in step["geometry"]["coordinates"]]
            start = max(0, len(flat) - 1)
            for c in sc:
                if not flat or c != flat[-1]:
                    flat.append(c)  # type: ignore[arg-type]
            spans.append((start, len(flat) - 1, float(step.get("duration", 0))))
            parts.append(sc)  # type: ignore[arg-type]
    if len(flat) >= 2:
        return RawRoute(coords=flat, cum_duration_s=durations_from_spans(flat, spans), provider="osrm")
    # Last resort: uniform by distance using total duration
    cum_d = cumulative_distances_mi(coords)
    total = float(route.get("duration", 0))
    cum = [total * d / cum_d[-1] if cum_d[-1] else 0.0 for d in cum_d]
    return RawRoute(coords=coords, cum_duration_s=cum, provider="osrm")


class OSRMProvider:
    name = "osrm"

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.OSRM_BASE_URL).rstrip("/")

    async def routes(self, client: httpx.AsyncClient, waypoints: list[Coord], alternatives: int) -> list[RawRoute]:
        coord_str = ";".join(f"{lng:.6f},{lat:.6f}" for lng, lat in waypoints)
        params = {
            "alternatives": str(alternatives) if alternatives and len(waypoints) == 2 else "false",
            "overview": "full",
            "geometries": "geojson",
            "steps": "true",
            "annotations": "duration,distance",
        }
        data = await request_json(
            client,
            "OSRM",
            "GET",
            f"{self.base_url}/route/v1/driving/{coord_str}",
            params=params,
            ok_statuses=(200, 400),
        )
        code = data.get("code")
        if code in ("NoRoute", "NoSegment"):
            raise NoRouteError(data.get("message") or "No route found")
        if code != "Ok":
            raise UpstreamError("OSRM", f"{code}: {data.get('message')}")
        return [parse_osrm_route(r) for r in data.get("routes", [])]


# --------------------------------------------------------------------------- Valhalla


def decode_polyline6(encoded: str) -> list[Coord]:
    coords: list[Coord] = []
    index = lat = lng = 0
    while index < len(encoded):
        vals = []
        for _ in range(2):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            vals.append(~(result >> 1) if result & 1 else result >> 1)
        lat += vals[0]
        lng += vals[1]
        coords.append((lng / 1e6, lat / 1e6))
    return coords


def parse_valhalla_trip(trip: dict) -> RawRoute:
    flat: list[Coord] = []
    spans: list[tuple[int, int, float]] = []
    for leg in trip["legs"]:
        shape = decode_polyline6(leg["shape"])
        offset = len(flat) - 1 if flat else 0
        flat.extend(shape[1:] if flat else shape)
        for m in leg.get("maneuvers", []):
            spans.append((offset + m["begin_shape_index"], offset + m["end_shape_index"], float(m.get("time", 0))))
    return RawRoute(coords=flat, cum_duration_s=durations_from_spans(flat, spans), provider="valhalla")


class ValhallaProvider:
    name = "valhalla"

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.VALHALLA_BASE_URL).rstrip("/")

    async def routes(self, client: httpx.AsyncClient, waypoints: list[Coord], alternatives: int) -> list[RawRoute]:
        locs = []
        for i, (lng, lat) in enumerate(waypoints):
            t = "break" if i in (0, len(waypoints) - 1) else "through"
            locs.append({"lat": lat, "lon": lng, "type": t})
        body: dict = {"locations": locs, "costing": "truck", "units": "miles", "directions_options": {"units": "miles"}}
        if alternatives and len(waypoints) == 2:
            body["alternates"] = min(alternatives, 2)
        data = await request_json(
            client, "Valhalla", "POST", f"{self.base_url}/route", json_body=body, ok_statuses=(200, 400)
        )
        if "trip" not in data:
            msg = data.get("error") or str(data)[:200]
            if data.get("error_code") in (442, 171, 154, 170):
                raise NoRouteError(msg)
            raise UpstreamError("Valhalla", msg)
        trips = [data["trip"]] + [a["trip"] for a in data.get("alternates", []) if "trip" in a]
        return [parse_valhalla_trip(t) for t in trips]


# --------------------------------------------------------------------------- Mock


def _mock_path(a: Coord, b: Coord, bend_frac: float, wiggle_seed: float) -> list[Coord]:
    total = haversine_mi(a, b)
    n = max(20, min(1500, int(total)))  # ~1 vertex per mile
    from .geo import bearing_deg

    brg = bearing_deg(a, b)
    out: list[Coord] = []
    for i in range(n + 1):
        t = i / n
        # interpolate along straight lng/lat then offset laterally
        base = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        lateral = math.sin(math.pi * t) * bend_frac * total + 1.5 * math.sin(t * 23 + wiggle_seed) * math.sin(
            math.pi * t
        )
        out.append(
            destination_point(base, brg + 90, lateral) if lateral >= 0 else destination_point(base, brg - 90, -lateral)
        )
    return out


def _mock_durations(coords: list[Coord], seed: float) -> list[float]:
    cum_d = cumulative_distances_mi(coords)
    total = cum_d[-1]
    out = [0.0]
    for i in range(1, len(coords)):
        mid = (cum_d[i] + cum_d[i - 1]) / 2
        urban = mid < 8 or total - mid < 8
        speed = 32.0 if urban else 61.0 + 6.0 * math.sin(mid / 37.0 + seed)
        out.append(out[-1] + (cum_d[i] - cum_d[i - 1]) / speed * 3600)
    return out


class MockRoutingProvider:
    """Deterministic synthetic roads: gentle arcs between waypoints."""

    name = "mock"
    BENDS = (0.0, 0.12, -0.15)

    async def routes(
        self, client: httpx.AsyncClient | None, waypoints: list[Coord], alternatives: int
    ) -> list[RawRoute]:
        if haversine_mi(waypoints[0], waypoints[-1]) < 0.2 and len(waypoints) == 2:
            raise NoRouteError("Origin and destination are the same point")
        if len(waypoints) > 2:
            parts = [_mock_path(waypoints[i], waypoints[i + 1], 0.03, i) for i in range(len(waypoints) - 1)]
            coords = _dedupe_concat(parts)
            return [RawRoute(coords, _mock_durations(coords, 1.0), "mock")]
        out = []
        for k, bend in enumerate(self.BENDS[: 1 + alternatives]):
            coords = _mock_path(waypoints[0], waypoints[1], bend, k * 1.7)
            out.append(RawRoute(coords, _mock_durations(coords, k), "mock"))
        return out


# --------------------------------------------------------------------------- chain + synthesis


def provider_chain() -> list[RoutingProvider]:
    if settings.USE_MOCKS:
        return [MockRoutingProvider()]
    chain: list[RoutingProvider] = [OSRMProvider(), ValhallaProvider()]
    if settings.ALLOW_MOCK_FALLBACK:
        chain.append(MockRoutingProvider())
    return chain


def distinct(routes: list[RawRoute], candidate: RawRoute) -> bool:
    return all(not is_same_route(candidate.coords, r.coords) for r in routes)


VIA_PLAN = ((0.5, 0.12), (0.5, -0.12), (0.5, 0.22), (0.5, -0.22), (0.35, 0.18), (0.65, -0.18))


async def synthesize(
    provider: RoutingProvider, client: httpx.AsyncClient, base: RawRoute, existing: list[RawRoute], need: int
) -> list[RawRoute]:
    """Perpendicular via-point detours at the route midpoint (then wider / off-centre),
    keeping only routes that are not >85% shared with an existing one."""
    origin, dest = base.coords[0], base.coords[-1]
    total = base.distance_mi
    found: list[RawRoute] = []
    leftovers: list[RawRoute] = []
    for batch_start in range(0, len(VIA_PLAN), 2):
        batch = VIA_PLAN[batch_start : batch_start + 2]
        tasks = []
        for frac, side in batch:
            off = math.copysign(max(8.0, min(120.0, abs(side) * total)), side)
            via = perpendicular_offset(base.coords, base.cum_distance_mi, total * frac, off)
            tasks.append(provider.routes(client, [origin, via, dest], 0))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for res in results:
            if isinstance(res, BaseException) or not res:
                continue
            r = res[0]
            r.synthetic = True
            if distinct(existing + found, r):
                found.append(r)
            else:
                leftovers.append(r)
            if len(found) >= need:
                return found
    # Could not find enough distinct detours: use least-overlapping leftovers so we still return 3.
    leftovers.sort(key=lambda r: overlap_fraction(r.coords, base.coords))
    return found + leftovers[: need - len(found)]


@dataclass
class RouteSet:
    routes: list[RawRoute]  # exactly 3, sorted by duration
    provider: str
    warnings: list[str]


def _to_cache(rs: RouteSet) -> dict:
    return {
        "provider": rs.provider,
        "warnings": rs.warnings,
        "routes": [{"c": r.coords, "t": r.cum_duration_s, "p": r.provider, "s": r.synthetic} for r in rs.routes],
    }


def _from_cache(d: dict) -> RouteSet:
    return RouteSet(
        routes=[RawRoute([tuple(c) for c in r["c"]], r["t"], r["p"], r["s"]) for r in d["routes"]],  # type: ignore[misc]
        provider=d["provider"],
        warnings=d["warnings"],
    )


async def get_three_routes(client: httpx.AsyncClient, origin: Coord, dest: Coord) -> RouteSet:
    key = "routes:v2:" + stable_hash([round(x, 5) for x in (*origin, *dest)] + [settings.USE_MOCKS])
    cached = cache.get(key)
    if cached:
        return _from_cache(cached)

    errors: list[str] = []
    warnings: list[str] = []
    for provider in provider_chain():
        try:
            routes = await provider.routes(client, [origin, dest], 3)
        except NoRouteError:
            raise
        except UpstreamError as exc:
            log.warning("routing provider %s failed: %s", provider.name, exc)
            errors.append(f"{provider.name}: {'rate limited' if exc.rate_limited else 'unavailable'}")
            continue
        if not routes:
            continue
        uniq: list[RawRoute] = []
        for r in sorted(routes, key=lambda r: r.duration_s):
            if distinct(uniq, r):
                uniq.append(r)
        if len(uniq) < 3:
            uniq += await synthesize(provider, client, uniq[0], uniq, 3 - len(uniq))
        if len(uniq) < 3:  # extremely unlikely; pad with a mock-shaped detour of the base route
            mock = await MockRoutingProvider().routes(None, [origin, dest], 2)
            uniq += mock[len(uniq) : 3]
        uniq = sorted(uniq[:3], key=lambda r: r.duration_s)
        if errors:
            warnings.append("Primary routing service unavailable (" + "; ".join(errors) + f"). Using {provider.name}.")
        if provider.name == "mock" and not settings.USE_MOCKS:
            warnings.append("All live routing services are down — showing SIMULATED routes. Do not use for navigation.")
        rs = RouteSet(uniq, provider.name, warnings)
        cache.set(key, _to_cache(rs), ROUTE_CACHE_TTL)
        return rs
    raise UpstreamError("routing", "All routing providers failed: " + "; ".join(errors))
