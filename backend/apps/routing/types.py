from __future__ import annotations

from dataclasses import dataclass, field

from .geo import Coord, cumulative_distances_mi


@dataclass
class RawRoute:
    """A provider route. ``cum_duration_s`` has one entry per vertex in ``coords``."""

    coords: list[Coord]
    cum_duration_s: list[float]
    provider: str
    synthetic: bool = False
    cum_distance_mi: list[float] = field(default_factory=list)

    def __post_init__(self) -> None:
        if len(self.coords) != len(self.cum_duration_s):
            raise ValueError("coords and cum_duration_s length mismatch")
        if not self.cum_distance_mi:
            self.cum_distance_mi = cumulative_distances_mi(self.coords)

    @property
    def distance_mi(self) -> float:
        return self.cum_distance_mi[-1]

    @property
    def duration_s(self) -> float:
        return self.cum_duration_s[-1]


def durations_from_spans(coords: list[Coord], spans: list[tuple[int, int, float]]) -> list[float]:
    """Build per-vertex cumulative durations from (start_idx, end_idx, seconds) spans
    (e.g. OSRM steps or Valhalla maneuvers), distributing each span's time by distance."""
    cum_d = cumulative_distances_mi(coords)
    out = [0.0] * len(coords)
    covered = 0
    t0 = 0.0
    for s, e, secs in spans:
        s = max(s, covered)
        e = min(e, len(coords) - 1)
        if e <= s:
            t0 += secs
            continue
        span_d = cum_d[e] - cum_d[s]
        for i in range(s + 1, e + 1):
            frac = 1.0 / (e - s) * (i - s) if span_d == 0 else (cum_d[i] - cum_d[s]) / span_d
            out[i] = t0 + secs * frac
        t0 += secs
        covered = e
    for i in range(covered + 1, len(coords)):
        out[i] = out[covered]
    # enforce monotonic
    for i in range(1, len(out)):
        if out[i] < out[i - 1]:
            out[i] = out[i - 1]
    return out
