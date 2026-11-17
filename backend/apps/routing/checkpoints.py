"""Checkpoint placement and ETA interpolation (pure)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .geo import Coord, point_at_distance, value_at_distance
from .types import RawRoute

AUTO = "auto"
DEDUP_EPS_MI = 0.05


def resolve_interval(mode: str | int, total_mi: float) -> int:
    """'auto': <=200 mi -> 10, <=800 mi -> 25, else 50. Otherwise the explicit 10/25/50."""
    if str(mode) == AUTO:
        if total_mi <= 200:
            return 10
        if total_mi <= 800:
            return 25
        return 50
    value = int(mode)
    if value not in (10, 25, 50):
        raise ValueError("interval must be 10, 25, 50 or 'auto'")
    return value


def checkpoint_distances(total_mi: float, interval_mi: float) -> list[float]:
    """0, N, 2N, ... and the destination. A regular checkpoint that coincides with the
    destination (within 0.05 mi) is not duplicated."""
    if interval_mi <= 0:
        raise ValueError("interval must be positive")
    out = [0.0]
    d = interval_mi
    while d < total_mi - DEDUP_EPS_MI:
        out.append(d)
        d += interval_mi
    if total_mi > DEDUP_EPS_MI or len(out) == 0:
        out.append(total_mi)
    return out


@dataclass(frozen=True)
class Checkpoint:
    index: int
    distance_mi: float
    coord: Coord
    elapsed_s: float
    eta: datetime  # UTC aware


def eta_at_distance(route: RawRoute, departure_utc: datetime, d: float) -> tuple[float, datetime]:
    elapsed = value_at_distance(route.cum_distance_mi, route.cum_duration_s, d)
    return elapsed, departure_utc + timedelta(seconds=elapsed)


def build_checkpoints(route: RawRoute, departure_utc: datetime, interval_mi: float) -> list[Checkpoint]:
    if departure_utc.tzinfo is None:
        raise ValueError("departure must be timezone-aware")
    out: list[Checkpoint] = []
    for i, d in enumerate(checkpoint_distances(route.distance_mi, interval_mi)):
        elapsed, eta = eta_at_distance(route, departure_utc, d)
        out.append(
            Checkpoint(
                index=i,
                distance_mi=d,
                coord=point_at_distance(route.coords, route.cum_distance_mi, d),
                elapsed_s=elapsed,
                eta=eta,
            )
        )
    return out
