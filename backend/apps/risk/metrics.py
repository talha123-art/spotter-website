"""Route-level metrics with midpoint-to-midpoint distance ownership (pure)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field


@dataclass(frozen=True)
class CheckpointRisk:
    distance_mi: float
    level: int | None  # None = forecast unavailable


def ownership(distances: Sequence[float], total_mi: float) -> list[tuple[float, float]]:
    """Each checkpoint owns the span from the midpoint with its previous neighbour to the
    midpoint with its next neighbour. First starts at 0, last ends at the route end."""
    n = len(distances)
    out: list[tuple[float, float]] = []
    for i, d in enumerate(distances):
        start = 0.0 if i == 0 else (distances[i - 1] + d) / 2
        end = total_mi if i == n - 1 else (d + distances[i + 1]) / 2
        out.append((start, end))
    return out


@dataclass
class RouteMetrics:
    miles_by_level: list[float] = field(default_factory=lambda: [0.0] * 5)
    unknown_miles: float = 0.0
    avg_risk: float = 0.0
    worst_level: int | None = None
    no_travel_checkpoints: int = 0
    unavailable_checkpoints: int = 0
    distance_mi: float = 0.0
    duration_s: float = 0.0

    @property
    def no_travel_miles(self) -> float:
        return self.miles_by_level[4]

    @property
    def severe_miles(self) -> float:
        return self.miles_by_level[3]

    @property
    def high_miles(self) -> float:
        return self.miles_by_level[2]

    def as_dict(self) -> dict:
        return {
            "miles_by_level": [round(m, 2) for m in self.miles_by_level],
            "unknown_miles": round(self.unknown_miles, 2),
            "avg_risk": round(self.avg_risk, 3),
            "worst_level": self.worst_level,
            "no_travel_checkpoints": self.no_travel_checkpoints,
            "unavailable_checkpoints": self.unavailable_checkpoints,
            "distance_mi": round(self.distance_mi, 2),
            "duration_s": round(self.duration_s),
        }


def compute_metrics(checkpoints: Sequence[CheckpointRisk], total_mi: float, duration_s: float) -> RouteMetrics:
    m = RouteMetrics(distance_mi=total_mi, duration_s=duration_s)
    spans = ownership([c.distance_mi for c in checkpoints], total_mi)
    weighted = 0.0
    known = 0.0
    for cp, (start, end) in zip(checkpoints, spans, strict=True):
        miles = max(0.0, end - start)
        if cp.level is None:
            m.unknown_miles += miles
            m.unavailable_checkpoints += 1
            continue
        m.miles_by_level[cp.level] += miles
        weighted += cp.level * miles
        known += miles
        m.worst_level = cp.level if m.worst_level is None else max(m.worst_level, cp.level)
        if cp.level == 4:
            m.no_travel_checkpoints += 1
    m.avg_risk = weighted / known if known > 0 else 0.0
    return m
