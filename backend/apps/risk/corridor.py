"""Heatmap corridor sampling grid around routes (pure)."""

from __future__ import annotations

from collections.abc import Sequence

from apps.routing.geo import Coord, cumulative_distances_mi, perpendicular_offset

MAX_POINTS = 300
LATERAL_MI = (-10.0, 0.0, 10.0)


def _sample(routes: Sequence[Sequence[Coord]], spacing_mi: float, round_deg: float) -> list[Coord]:
    seen: set[tuple[int, int]] = set()
    pts: list[Coord] = []
    for coords in routes:
        cum = cumulative_distances_mi(coords)
        total = cum[-1]
        n = max(1, round(total / spacing_mi))
        step = total / n if n else 0
        for k in range(n + 1):
            d = k * step
            for off in LATERAL_MI:
                p = perpendicular_offset(coords, cum, d, off)
                key = (round(p[0] / round_deg), round(p[1] / round_deg))
                if key in seen:
                    continue
                seen.add(key)
                pts.append((round(key[0] * round_deg, 4), round(key[1] * round_deg, 4)))
    return pts


def corridor_points(routes: Sequence[Sequence[Coord]], max_points: int = MAX_POINTS) -> list[Coord]:
    """Points every ~15-25 mi along each route with +/-10 mi lateral offsets, deduplicated
    on a ~0.1 deg grid and capped at ``max_points`` by widening the spacing."""
    spacing = 15.0
    round_deg = 0.1
    pts = _sample(routes, spacing, round_deg)
    while len(pts) > max_points:
        spacing *= 1.2
        if spacing > 25:
            round_deg *= 1.25  # very long trips: coarser grid beyond 25 mi
        pts = _sample(routes, spacing, round_deg)
    return pts
