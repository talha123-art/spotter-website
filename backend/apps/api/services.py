"""Orchestration: routes -> checkpoints -> weather -> risk -> metrics -> recommendation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from django.core.cache import cache

from apps.risk.corridor import corridor_points
from apps.risk.metrics import CheckpointRisk, compute_metrics, ownership
from apps.risk.ranking import Candidate, recommend
from apps.risk.rules import LABELS, Risk, classify
from apps.routing.checkpoints import build_checkpoints, resolve_interval
from apps.routing.geo import Coord, round_coords, simplify, slice_by_distance
from apps.routing.providers import IDS, RouteSet, get_three_routes
from apps.routing.providers import LABELS as ROUTE_LABELS
from apps.weather.interpolate import HourlySeries, interpolate_at
from apps.weather.providers import fetch_hourly
from common.http import make_client, stable_hash

HEATMAP_HOURS = 48
HEATMAP_TTL = 15 * 60


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def tolerance_for(miles: float) -> float:
    if miles < 150:
        return 0.0003
    if miles < 600:
        return 0.0008
    return 0.0015


def classify_sample(series: HourlySeries | None, at: datetime, load_lb: float) -> tuple[dict | None, dict]:
    sample = interpolate_at(series, at)
    if sample is None:
        return None, {
            "levels": None,
            "base_level": None,
            "level": None,
            "dominant": None,
            "load_override": False,
            "reason": "Forecast unavailable at ETA",
        }
    wx = sample.as_dict()  # classification uses the same rounded values that are displayed
    a = classify(wx["wind_mph"], wx["rain_in"], wx["snow_in"], load_lb)
    return wx, a.as_dict()


def _segments(
    coords: list[Coord], cum: list[float], spans: list[tuple[float, float]], levels: list[int | None], tol: float
):
    """Route split by checkpoint ownership, consecutive equal levels merged."""
    merged: list[tuple[float, float, int | None]] = []
    for (s, e), lvl in zip(spans, levels, strict=True):
        if merged and merged[-1][2] == lvl:
            merged[-1] = (merged[-1][0], e, lvl)
        else:
            merged.append((s, e, lvl))
    return [
        {"level": lvl, "coords": round_coords(simplify(slice_by_distance(coords, cum, s, e), tol))}
        for s, e, lvl in merged
    ]


def _summary(cps: list[dict]) -> str:
    avail = [c for c in cps if c["level"] is not None]
    if not avail:
        return "Forecast unavailable for this trip window"
    worst = max(avail, key=lambda c: (c["level"], c["distance_mi"] * -1))
    unavailable = len(cps) - len(avail)
    suffix = f" · {unavailable} checkpoint(s) beyond forecast" if unavailable else ""
    if worst["level"] == 0:
        return "Low risk along the entire route" + suffix
    return f"{worst['reason']} at mile {worst['distance_mi']:.0f}" + suffix


async def analyze(origin: Coord, dest: Coord, departure: datetime, load_lb: int, interval_mode: str) -> dict:
    departure = departure.astimezone(UTC)
    async with make_client() as client:
        rs: RouteSet = await get_three_routes(client, origin, dest)
        interval = resolve_interval(interval_mode, rs.routes[0].distance_mi)
        cps_by_route = [build_checkpoints(r, departure, interval) for r in rs.routes]
        pts = [cp.coord for cps in cps_by_route for cp in cps]
        end = max(cps[-1].eta for cps in cps_by_route)
        series, wx_provider, wx_warn = await fetch_hourly(client, pts, departure, end)

    routes_out = []
    candidates = []
    k = 0
    for idx, (route, cps) in enumerate(zip(rs.routes, cps_by_route, strict=True)):
        cp_out = []
        for cp in cps:
            s = series[k]
            k += 1
            wx, risk = classify_sample(s, cp.eta, load_lb)
            cp_out.append(
                {
                    "index": cp.index,
                    "distance_mi": round(cp.distance_mi, 2),
                    "lat": round(cp.coord[1], 5),
                    "lng": round(cp.coord[0], 5),
                    "eta": iso(cp.eta),
                    "elapsed_s": round(cp.elapsed_s),
                    "timezone": s.timezone if s else "UTC",
                    "forecast_available": wx is not None,
                    "weather": wx,
                    **risk,
                    "level_label": LABELS[Risk(risk["level"])] if risk["level"] is not None else "Unavailable",
                }
            )
        metrics = compute_metrics(
            [CheckpointRisk(c["distance_mi"], c["level"]) for c in cp_out], route.distance_mi, route.duration_s
        )
        spans = ownership([cp.distance_mi for cp in cps], route.distance_mi)
        tol = tolerance_for(route.distance_mi)
        rid = IDS[idx]
        routes_out.append(
            {
                "id": rid,
                "label": ROUTE_LABELS[idx],
                "provider": route.provider,
                "synthetic": route.synthetic,
                "distance_mi": round(route.distance_mi, 1),
                "duration_s": round(route.duration_s),
                "departure": iso(departure),
                "arrival": iso(departure + timedelta(seconds=route.duration_s)),
                "geometry": round_coords(simplify(route.coords, tol)),
                "segments": _segments(route.coords, route.cum_distance_mi, spans, [c["level"] for c in cp_out], tol),
                "checkpoints": cp_out,
                "metrics": metrics.as_dict(),
                "summary": _summary(cp_out),
            }
        )
        candidates.append(Candidate(rid, ROUTE_LABELS[idx], metrics))

    rec = recommend(candidates)
    order = {rid: i for i, rid in enumerate(rec.order)}
    for r in routes_out:
        r["rank"] = order[r["id"]] + 1
        r["recommended"] = r["id"] == rec.winner_id
    routes_out.sort(key=lambda r: r["rank"])

    return {
        "origin": {"lat": origin[1], "lng": origin[0]},
        "destination": {"lat": dest[1], "lng": dest[0]},
        "departure": iso(departure),
        "load_weight_lb": load_lb,
        "interval_mode": str(interval_mode),
        "interval_mi": interval,
        "providers": {"routing": rs.provider, "weather": wx_provider},
        "warnings": rs.warnings + wx_warn,
        "routes": routes_out,
        "recommendation": rec.as_dict(),
        "generated_at": iso(datetime.now(UTC)),
    }


async def heatmap(origin: Coord, dest: Coord, departure: datetime, load_lb: int) -> dict:
    base = departure.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    key = "heat:v1:" + stable_hash([round(x, 5) for x in (*origin, *dest)] + [base.isoformat(), load_lb])
    cached = cache.get(key)
    if cached:
        return cached
    async with make_client() as client:
        rs = await get_three_routes(client, origin, dest)
        lines = [simplify(r.coords, 0.01) for r in rs.routes]
        pts = corridor_points(lines)
        series, wx_provider, warnings = await fetch_hourly(client, pts, base, base + timedelta(hours=HEATMAP_HOURS))

    hours = [base + timedelta(hours=h) for h in range(HEATMAP_HOURS + 1)]
    points = []
    for p, s in zip(pts, series, strict=True):
        risks = []
        for t in hours:
            wx, risk = classify_sample(s, t, load_lb)
            risks.append(-1 if risk["level"] is None else risk["level"])
        points.append([round(p[1], 4), round(p[0], 4), risks])
    out = {
        "base_time": iso(base),
        "hours": len(hours),
        "load_weight_lb": load_lb,
        "provider": wx_provider,
        "warnings": rs.warnings + warnings,
        "points": points,
    }
    cache.set(key, out, HEATMAP_TTL)
    return out
