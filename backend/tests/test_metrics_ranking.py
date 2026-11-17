import pytest

from apps.risk.metrics import CheckpointRisk, RouteMetrics, compute_metrics, ownership
from apps.risk.ranking import Candidate, fmt_duration, rank, recommend


def test_ownership_midpoints():
    assert ownership([0, 25, 50, 60], 60) == [(0, 12.5), (12.5, 37.5), (37.5, 55), (55, 60)]


def test_metrics_miles_per_level_sum_to_total():
    cps = [CheckpointRisk(0, 0), CheckpointRisk(25, 3), CheckpointRisk(50, 4), CheckpointRisk(60, 1)]
    m = compute_metrics(cps, 60, 3600)
    assert m.miles_by_level == [12.5, 5, 0, 25, 17.5]
    assert sum(m.miles_by_level) == pytest.approx(60)
    assert m.worst_level == 4
    assert m.no_travel_checkpoints == 1
    assert m.avg_risk == pytest.approx((0 * 12.5 + 3 * 25 + 4 * 17.5 + 1 * 5) / 60)


def test_metrics_unknown_checkpoints():
    cps = [CheckpointRisk(0, 2), CheckpointRisk(10, None)]
    m = compute_metrics(cps, 10, 600)
    assert m.unknown_miles == 5
    assert m.unavailable_checkpoints == 1
    assert m.avg_risk == 2


def mk(id_, levels=(0, 0, 0, 0, 0), dur=3600, ntcp=None, avg=None):
    m = RouteMetrics(miles_by_level=list(levels), duration_s=dur)
    m.no_travel_checkpoints = (1 if levels[4] > 0 else 0) if ntcp is None else ntcp
    tot = sum(levels) or 1
    m.avg_risk = sum(i * x for i, x in enumerate(levels)) / tot if avg is None else avg
    return Candidate(id_, id_.title(), m)


def ids(cs):
    return [c.id for c in cs]


def test_rank_no_travel_first():
    a = mk("a", (0, 0, 0, 0, 5), dur=100)
    b = mk("b", (0, 0, 0, 100, 0), dur=999)
    assert ids(rank([a, b])) == ["b", "a"]


def test_rank_severe_then_high_then_avg_then_time():
    a = mk("a", (50, 0, 10, 20, 0), dur=100)
    b = mk("b", (50, 0, 30, 10, 0), dur=200)
    assert ids(rank([a, b])) == ["b", "a"]  # fewer severe beats more high
    c = mk("c", (60, 0, 5, 10, 0), dur=300)
    assert ids(rank([a, b, c])) == ["c", "b", "a"]  # severe tie (10) -> fewer high


def test_rank_avg_risk_then_duration():
    a = mk("a", (10, 20, 0, 0, 0), dur=100)
    b = mk("b", (25, 5, 0, 0, 0), dur=500)
    assert ids(rank([a, b])) == ["b", "a"]
    c = mk("c", (25, 5, 0, 0, 0), dur=400)
    assert ids(rank([a, b, c])) == ["c", "b", "a"]


def test_miles_difference_below_half_mile_is_tie():
    a = mk("a", (100, 0, 0, 10.4, 0), dur=100, avg=0.3)
    b = mk("b", (100, 0, 0, 10.0, 0), dur=200, avg=0.3)
    # severe diff 0.4 < 0.5 -> tie -> high tie -> avg tie -> faster wins
    assert ids(rank([b, a])) == ["a", "b"]


def test_miles_difference_half_mile_is_not_tie():
    a = mk("a", (100, 0, 0, 10.5, 0), dur=100, avg=0.3)
    b = mk("b", (100, 0, 0, 10.0, 0), dur=200, avg=0.3)
    assert ids(rank([a, b])) == ["b", "a"]


def test_full_tie_is_stable():
    a = mk("a", dur=100)
    b = mk("b", dur=100)
    assert ids(rank([a, b])) == ["a", "b"]
    assert ids(rank([b, a])) == ["b", "a"]


def test_all_no_travel_least_bad():
    a = mk("a", (0, 0, 0, 0, 30), dur=100)
    b = mk("b", (0, 0, 0, 50, 10), dur=200)
    rec = recommend([a, b])
    assert rec.winner_id == "b"
    assert rec.all_have_no_travel
    assert "Every route crosses No Travel" in rec.explanation


def test_explanation_tradeoff_text():
    fastest = mk("fastest", (100, 0, 0, 42, 0), dur=3600)
    alt = mk("alt", (142, 0, 0, 0, 0), dur=3600 + 38 * 60)
    rec = recommend([fastest, alt])
    assert rec.winner_id == "alt"
    assert rec.decisive == "severe"
    assert rec.tradeoff == "+38 min vs Fastest, but avoids 42 Severe miles."
    assert "42 fewer Severe-risk miles" in rec.explanation


def test_duration_decides_when_risk_equal():
    a = mk("a", dur=4000)
    b = mk("b", dur=3000)
    rec = recommend([a, b])
    assert rec.winner_id == "b" and rec.decisive == "duration"
    assert "saves 17 min" in rec.explanation


def test_fmt_duration():
    assert fmt_duration(38 * 60) == "38 min"
    assert fmt_duration(3900) == "1 h 05 min"
    assert fmt_duration(-600) == "10 min"
