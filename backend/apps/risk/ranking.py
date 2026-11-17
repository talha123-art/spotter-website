"""Route recommendation: strict lexicographic ranking with tie tolerance (pure)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from functools import cmp_to_key

from .metrics import RouteMetrics

MILES_TIE = 0.5  # differences below this are ties
AVG_TIE = 1e-3
DURATION_TIE_S = 0.0  # last criterion: strict


@dataclass(frozen=True)
class Candidate:
    id: str
    label: str
    metrics: RouteMetrics

    @property
    def has_no_travel(self) -> bool:
        return self.metrics.no_travel_checkpoints > 0 or self.metrics.no_travel_miles >= MILES_TIE


def _cmp_num(a: float, b: float, tol: float) -> int:
    if abs(a - b) < tol or (tol == 0 and a == b):
        return 0
    return -1 if a < b else 1


def _criteria(a: Candidate, b: Candidate) -> list[tuple[str, int]]:
    """Ordered (criterion, cmp) pairs; negative cmp means ``a`` is better."""
    out: list[tuple[str, int]] = [
        ("no_travel", (a.has_no_travel > b.has_no_travel) - (a.has_no_travel < b.has_no_travel))
    ]
    if a.has_no_travel and b.has_no_travel:
        out.append(("no_travel_miles", _cmp_num(a.metrics.no_travel_miles, b.metrics.no_travel_miles, MILES_TIE)))
    out += [
        ("severe", _cmp_num(a.metrics.severe_miles, b.metrics.severe_miles, MILES_TIE)),
        ("high", _cmp_num(a.metrics.high_miles, b.metrics.high_miles, MILES_TIE)),
        ("avg_risk", _cmp_num(a.metrics.avg_risk, b.metrics.avg_risk, AVG_TIE)),
        ("duration", _cmp_num(a.metrics.duration_s, b.metrics.duration_s, DURATION_TIE_S)),
    ]
    return out


def compare(a: Candidate, b: Candidate) -> int:
    for _, c in _criteria(a, b):
        if c:
            return c
    return 0


def decisive(a: Candidate, b: Candidate) -> str | None:
    for name, c in _criteria(a, b):
        if c:
            return name
    return None


def rank(candidates: Sequence[Candidate]) -> list[Candidate]:
    """Stable sort: full ties keep input order."""
    return sorted(candidates, key=cmp_to_key(compare))


def fmt_duration(seconds: float) -> str:
    total_min = int(round(abs(seconds) / 60))
    h, m = divmod(total_min, 60)
    if h == 0:
        return f"{m} min"
    return f"{h} h {m:02d} min"


def _mi(x: float) -> str:
    return f"{x:,.0f}" if x >= 10 else f"{x:,.1f}"


@dataclass(frozen=True)
class Recommendation:
    winner_id: str
    order: list[str]
    explanation: str
    tradeoff: str
    all_have_no_travel: bool
    decisive: str | None

    def as_dict(self) -> dict:
        return {
            "route_id": self.winner_id,
            "ranking": self.order,
            "explanation": self.explanation,
            "tradeoff": self.tradeoff,
            "all_have_no_travel": self.all_have_no_travel,
            "decisive_factor": self.decisive,
        }


def recommend(candidates: Sequence[Candidate]) -> Recommendation:
    if not candidates:
        raise ValueError("no candidates")
    ordered = rank(candidates)
    w = ordered[0]
    all_nt = all(c.has_no_travel for c in candidates)
    if len(ordered) == 1:
        return Recommendation(w.id, [w.id], f"{w.label} is the only available route.", "", all_nt, None)

    r = ordered[1]
    crit = decisive(w, r)
    wm, rm = w.metrics, r.metrics
    dt = wm.duration_s - rm.duration_s

    avoided = ""
    if crit == "no_travel":
        explanation = f"{w.label} avoids all No Travel conditions, while {r.label} crosses {_mi(rm.no_travel_miles)} No Travel miles."
        avoided = f"{_mi(rm.no_travel_miles)} No Travel miles"
    elif crit == "no_travel_miles":
        explanation = (
            f"Every route crosses No Travel conditions. {w.label} is the least bad with "
            f"{_mi(wm.no_travel_miles)} No Travel miles vs {_mi(rm.no_travel_miles)} on {r.label}. "
            "Consider delaying departure."
        )
        avoided = f"{_mi(rm.no_travel_miles - wm.no_travel_miles)} No Travel miles"
    elif crit == "severe":
        diff = rm.severe_miles - wm.severe_miles
        explanation = f"{w.label} has {_mi(diff)} fewer Severe-risk miles than {r.label}."
        avoided = f"{_mi(diff)} Severe miles"
    elif crit == "high":
        diff = rm.high_miles - wm.high_miles
        explanation = f"Severe exposure is equal; {w.label} has {_mi(diff)} fewer High-risk miles than {r.label}."
        avoided = f"{_mi(diff)} High miles"
    elif crit == "avg_risk":
        explanation = (
            f"Severe and High exposure are equal; {w.label} has a lower average risk "
            f"({wm.avg_risk:.2f} vs {rm.avg_risk:.2f})."
        )
        avoided = "some Moderate-risk miles"
    elif crit == "duration":
        explanation = (
            f"Weather risk is equivalent, so the faster route wins: {w.label} saves {fmt_duration(dt)} over {r.label}."
        )
    else:
        explanation = f"{w.label} and {r.label} are equivalent on risk and time."

    if all_nt and crit != "no_travel_miles":
        explanation = "Every route crosses No Travel conditions — consider delaying departure. " + explanation

    if crit in (None, "duration"):
        tradeoff = "No weather trade-off between the top routes." if crit else "No trade-off."
    elif dt > 60:
        tradeoff = f"+{fmt_duration(dt)} vs {r.label}, but avoids {avoided}."
    elif dt < -60:
        tradeoff = f"{fmt_duration(dt)} faster than {r.label} and avoids {avoided}."
    else:
        tradeoff = f"Same travel time as {r.label}; avoids {avoided}."

    return Recommendation(w.id, [c.id for c in ordered], explanation, tradeoff, all_nt, crit)
