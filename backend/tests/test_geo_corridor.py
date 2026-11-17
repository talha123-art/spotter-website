from apps.risk.corridor import corridor_points
from apps.routing.geo import (
    cumulative_distances_mi,
    destination_point,
    haversine_mi,
    is_same_route,
    perpendicular_offset,
    simplify,
)


def line(start, bearing, miles, n=200):
    return [destination_point(start, bearing, miles * i / (n - 1)) for i in range(n)]


def test_haversine_known_distance():
    # Chicago -> Denver ~ 920 mi great circle
    assert 900 < haversine_mi((-87.6298, 41.8781), (-104.9903, 39.7392)) < 930


def test_perpendicular_offset_is_lateral():
    coords = line((-100, 35), 0, 50)
    cum = cumulative_distances_mi(coords)
    p = perpendicular_offset(coords, cum, 25, 10)
    base = perpendicular_offset(coords, cum, 25, 0)
    assert abs(haversine_mi(p, base) - 10) < 0.05
    assert p[0] > base[0]  # right of a north-bound route is east


def test_simplify_keeps_endpoints_and_reduces():
    coords = line((-100, 35), 0, 100, n=1000)
    s = simplify(coords)
    assert s[0] == coords[0] and s[-1] == coords[-1]
    assert len(s) < 10


def test_same_route_overlap():
    a = line((-100, 35), 0, 100)
    assert is_same_route(a, list(a))
    # 10% different (detour on last 10 mi) still counts as same (>85% shared)
    b = a[:180] + line(a[180], 45, 12, n=20)
    assert is_same_route(a, b)
    c = line((-100, 35), 20, 100)
    assert not is_same_route(a, c)


def test_corridor_capped_and_lateral():
    routes = [line((-100, 35), 0, 1500), line((-100, 35), 30, 1500), line((-100, 35), -30, 1500)]
    pts = corridor_points(routes)
    assert 50 < len(pts) <= 300


def test_corridor_short_trip_dense():
    pts = corridor_points([line((-100, 35), 0, 60)])
    # 15 mi spacing -> 5 stations x 3 offsets
    assert len(pts) == 15
