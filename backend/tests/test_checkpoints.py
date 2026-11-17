from datetime import UTC, datetime, timedelta

import pytest

from apps.routing.checkpoints import build_checkpoints, checkpoint_distances, resolve_interval
from apps.routing.geo import cumulative_distances_mi, destination_point
from apps.routing.types import RawRoute, durations_from_spans

DEP = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)


def straight_route(total_mi: float, n: int = 101, speeds_mph: list[float] | None = None) -> RawRoute:
    """Due-north route; optional per-segment speed (piecewise) to test non-constant ETA."""
    start = (-100.0, 35.0)
    coords = [destination_point(start, 0, total_mi * i / (n - 1)) for i in range(n)]
    cum = cumulative_distances_mi(coords)
    dur = [0.0]
    for i in range(1, n):
        seg = cum[i] - cum[i - 1]
        speed = speeds_mph[min(len(speeds_mph) - 1, (i - 1) * len(speeds_mph) // (n - 1))] if speeds_mph else 60.0
        dur.append(dur[-1] + seg / speed * 3600)
    return RawRoute(coords=coords, cum_duration_s=dur, provider="test")


@pytest.mark.parametrize(
    "total,expected",
    [(0, 10), (150, 10), (200, 10), (200.1, 25), (800, 25), (800.1, 50), (2500, 50)],
)
def test_auto_interval(total, expected):
    assert resolve_interval("auto", total) == expected


@pytest.mark.parametrize("v", [10, 25, 50, "25"])
def test_explicit_interval(v):
    assert resolve_interval(v, 999) == int(v)


def test_invalid_interval():
    with pytest.raises(ValueError):
        resolve_interval(30, 100)


def test_checkpoint_spacing_includes_start_and_destination():
    assert checkpoint_distances(60, 25) == [0, 25, 50, 60]


def test_checkpoint_spacing_exact_multiple_not_duplicated():
    assert checkpoint_distances(50, 25) == [0, 25, 50]
    assert checkpoint_distances(50.03, 25) == [0, 25, 50.03]


def test_checkpoint_spacing_short_route():
    assert checkpoint_distances(7, 10) == [0, 7]


def test_build_checkpoints_positions_and_constant_speed_eta():
    r = straight_route(100)
    cps = build_checkpoints(r, DEP, 25)
    assert [round(c.distance_mi, 6) for c in cps] == [0, 25, 50, 75, round(r.distance_mi, 6)]
    # 60 mph -> 25 mi = 25 min
    assert cps[1].eta == pytest.approx(DEP + timedelta(minutes=25), abs=timedelta(seconds=1))
    assert cps[0].eta == DEP
    assert abs(cps[-1].eta - (DEP + timedelta(minutes=100))) < timedelta(seconds=2)


def test_eta_uses_variable_segment_speeds_not_average():
    # first half at 30 mph, second half at 70 mph
    r = straight_route(100, n=201, speeds_mph=[30, 70])
    cps = build_checkpoints(r, DEP, 25)
    assert (cps[1].eta - DEP).total_seconds() == pytest.approx(25 / 30 * 3600, rel=1e-3)
    assert (cps[2].eta - DEP).total_seconds() == pytest.approx(50 / 30 * 3600, rel=1e-3)
    assert (cps[3].eta - DEP).total_seconds() == pytest.approx((50 / 30 + 25 / 70) * 3600, rel=1e-3)
    # constant average speed would put checkpoint 1 at 25/42 h; ensure we are not doing that
    avg = r.duration_s / r.distance_mi
    assert abs((cps[1].eta - DEP).total_seconds() - 25 * avg) > 300


def test_eta_interpolates_within_segment():
    coords = [(-100.0, 35.0), destination_point((-100.0, 35.0), 0, 10)]
    r = RawRoute(coords=coords, cum_duration_s=[0, 600], provider="t")
    cps = build_checkpoints(r, DEP, 5)  # mid-segment
    assert (cps[1].eta - DEP).total_seconds() == pytest.approx(300, abs=0.5)


def test_requires_aware_departure():
    with pytest.raises(ValueError):
        build_checkpoints(straight_route(10), datetime(2026, 1, 1), 10)


def test_durations_from_spans_distributes_by_distance():
    start = (-100.0, 35.0)
    coords = [start, destination_point(start, 0, 1), destination_point(start, 0, 4), destination_point(start, 0, 5)]
    out = durations_from_spans(coords, [(0, 2, 400), (2, 3, 100)])
    assert out[0] == 0
    assert out[1] == pytest.approx(100, rel=1e-3)  # 1 of 4 miles
    assert out[2] == pytest.approx(400)
    assert out[3] == pytest.approx(500)
