"""Pure geometry helpers. Coordinates are (lng, lat) tuples (GeoJSON order)."""

from __future__ import annotations

import math
from bisect import bisect_right
from collections.abc import Sequence

EARTH_RADIUS_MI = 3958.7613
METERS_PER_MILE = 1609.344

Coord = tuple[float, float]  # (lng, lat)


def haversine_mi(a: Coord, b: Coord) -> float:
    lng1, lat1 = math.radians(a[0]), math.radians(a[1])
    lng2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(h)))


def cumulative_distances_mi(coords: Sequence[Coord]) -> list[float]:
    """Cumulative distance (miles) at every vertex; first element is 0."""
    out = [0.0]
    for i in range(1, len(coords)):
        out.append(out[-1] + haversine_mi(coords[i - 1], coords[i]))
    return out


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def point_at_distance(coords: Sequence[Coord], cum: Sequence[float], d: float) -> Coord:
    """Interpolated coordinate at distance ``d`` (miles) along the polyline."""
    if d <= 0:
        return coords[0]
    if d >= cum[-1]:
        return coords[-1]
    i = bisect_right(cum, d) - 1
    seg = cum[i + 1] - cum[i]
    t = 0.0 if seg == 0 else (d - cum[i]) / seg
    return (lerp(coords[i][0], coords[i + 1][0], t), lerp(coords[i][1], coords[i + 1][1], t))


def value_at_distance(cum: Sequence[float], values: Sequence[float], d: float) -> float:
    """Linear interpolation of a per-vertex series (e.g. cumulative duration) by distance."""
    if d <= cum[0]:
        return values[0]
    if d >= cum[-1]:
        return values[-1]
    i = bisect_right(cum, d) - 1
    seg = cum[i + 1] - cum[i]
    t = 0.0 if seg == 0 else (d - cum[i]) / seg
    return lerp(values[i], values[i + 1], t)


def slice_by_distance(coords: Sequence[Coord], cum: Sequence[float], start: float, end: float) -> list[Coord]:
    """Sub-polyline between two distances (inclusive, interpolated endpoints)."""
    start = max(0.0, start)
    end = min(cum[-1], end)
    if end <= start:
        p = point_at_distance(coords, cum, start)
        return [p, p]
    out = [point_at_distance(coords, cum, start)]
    i0 = bisect_right(cum, start)
    i1 = bisect_right(cum, end)
    for i in range(i0, i1):
        if start < cum[i] < end:
            out.append(coords[i])
    out.append(point_at_distance(coords, cum, end))
    return out


def bearing_deg(a: Coord, b: Coord) -> float:
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dlng = math.radians(b[0] - a[0])
    x = math.sin(dlng) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def destination_point(origin: Coord, bearing: float, dist_mi: float) -> Coord:
    lat1 = math.radians(origin[1])
    lng1 = math.radians(origin[0])
    brng = math.radians(bearing)
    dr = dist_mi / EARTH_RADIUS_MI
    lat2 = math.asin(math.sin(lat1) * math.cos(dr) + math.cos(lat1) * math.sin(dr) * math.cos(brng))
    lng2 = lng1 + math.atan2(
        math.sin(brng) * math.sin(dr) * math.cos(lat1),
        math.cos(dr) - math.sin(lat1) * math.sin(lat2),
    )
    return (((math.degrees(lng2) + 540) % 360) - 180, math.degrees(lat2))


def local_bearing(coords: Sequence[Coord], cum: Sequence[float], d: float, window_mi: float = 2.0) -> float:
    a = point_at_distance(coords, cum, max(0.0, d - window_mi))
    b = point_at_distance(coords, cum, min(cum[-1], d + window_mi))
    if a == b:
        return bearing_deg(coords[0], coords[-1])
    return bearing_deg(a, b)


def perpendicular_offset(coords: Sequence[Coord], cum: Sequence[float], d: float, offset_mi: float) -> Coord:
    """Point offset ``offset_mi`` to the right (+) or left (-) of the route at distance d."""
    base = point_at_distance(coords, cum, d)
    if offset_mi == 0:
        return base
    brg = local_bearing(coords, cum, d)
    side = 90 if offset_mi > 0 else -90
    return destination_point(base, brg + side, abs(offset_mi))


# --------------------------------------------------------------------------- simplification


def _perp_dist_sq(p: Coord, a: Coord, b: Coord, kx: float) -> float:
    ax, ay = a[0] * kx, a[1]
    bx, by = b[0] * kx, b[1]
    px, py = p[0] * kx, p[1]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return (px - ax) ** 2 + (py - ay) ** 2
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return (px - cx) ** 2 + (py - cy) ** 2


def simplify(coords: Sequence[Coord], tolerance_deg: float = 0.0008) -> list[Coord]:
    """Iterative Douglas-Peucker (tolerance in degrees of latitude, ~90 m default)."""
    n = len(coords)
    if n <= 2:
        return list(coords)
    mid_lat = coords[n // 2][1]
    kx = math.cos(math.radians(mid_lat))
    keep = [False] * n
    keep[0] = keep[-1] = True
    tol_sq = tolerance_deg * tolerance_deg
    stack = [(0, n - 1)]
    while stack:
        s, e = stack.pop()
        max_d, idx = -1.0, -1
        for i in range(s + 1, e):
            d = _perp_dist_sq(coords[i], coords[s], coords[e], kx)
            if d > max_d:
                max_d, idx = d, i
        if idx != -1 and max_d > tol_sq:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [c for c, k in zip(coords, keep, strict=True) if k]


def round_coords(coords: Sequence[Coord], ndigits: int = 5) -> list[list[float]]:
    return [[round(c[0], ndigits), round(c[1], ndigits)] for c in coords]


# --------------------------------------------------------------------------- overlap


def resample(coords: Sequence[Coord], step_mi: float) -> list[Coord]:
    cum = cumulative_distances_mi(coords)
    total = cum[-1]
    if total == 0:
        return [coords[0]]
    n = max(2, int(total / step_mi) + 1)
    return [point_at_distance(coords, cum, total * i / (n - 1)) for i in range(n)]


def _grid_key(c: Coord, cell: float) -> tuple[int, int]:
    return (int(math.floor(c[0] / cell)), int(math.floor(c[1] / cell)))


def overlap_fraction(a: Sequence[Coord], b: Sequence[Coord], tol_mi: float = 0.4, step_mi: float = 0.5) -> float:
    """Fraction of route ``a`` (resampled) lying within ``tol_mi`` of route ``b``."""
    pa = resample(a, step_mi)
    pb = resample(b, step_mi / 2)
    cell = 0.02  # ~1.4 mi in lat
    grid: dict[tuple[int, int], list[Coord]] = {}
    for p in pb:
        grid.setdefault(_grid_key(p, cell), []).append(p)
    hits = 0
    for p in pa:
        gx, gy = _grid_key(p, cell)
        found = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in grid.get((gx + dx, gy + dy), ()):
                    if haversine_mi(p, q) <= tol_mi:
                        found = True
                        break
                if found:
                    break
            if found:
                break
        hits += found
    return hits / len(pa)


def is_same_route(a: Sequence[Coord], b: Sequence[Coord], threshold: float = 0.85) -> bool:
    """Two routes are 'the same' when each shares > threshold of its length with the other."""
    return min(overlap_fraction(a, b), overlap_fraction(b, a)) > threshold
