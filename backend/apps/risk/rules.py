"""Risk classification rules (pure). Lower bounds are inclusive unless stated."""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class Risk(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return LABELS[self]


LABELS = {
    Risk.LOW: "Low",
    Risk.MODERATE: "Moderate",
    Risk.HIGH: "High",
    Risk.SEVERE: "Severe",
    Risk.NO_TRAVEL: "No Travel",
}

LOAD_NO_TRAVEL_LB = 30_000  # wind 45-<55 AND load > this -> No Travel
LOAD_SEVERE_LB = 40_000  # wind 35-<45 AND load > this -> at least Severe


def wind_level(mph: float) -> Risk:
    """<25 Low; 25-<35 Moderate; 35-<45 High; 45-<55 Severe; >=55 No Travel."""
    if mph < 25:
        return Risk.LOW
    if mph < 35:
        return Risk.MODERATE
    if mph < 45:
        return Risk.HIGH
    if mph < 55:
        return Risk.SEVERE
    return Risk.NO_TRAVEL


def rain_level(in_hr: float) -> Risk:
    """<0.10 Low; 0.10-<0.25 Moderate; 0.25-<0.50 High; 0.50-1.00 Severe; >1.00 No Travel."""
    if in_hr < 0.10:
        return Risk.LOW
    if in_hr < 0.25:
        return Risk.MODERATE
    if in_hr < 0.50:
        return Risk.HIGH
    if in_hr <= 1.00:
        return Risk.SEVERE
    return Risk.NO_TRAVEL


def snow_level(in_hr: float) -> Risk:
    """<0.5 Low; 0.5-<1.0 Moderate; 1.0-<2.0 High; 2.0-3.0 Severe; >3.0 No Travel."""
    if in_hr < 0.5:
        return Risk.LOW
    if in_hr < 1.0:
        return Risk.MODERATE
    if in_hr < 2.0:
        return Risk.HIGH
    if in_hr <= 3.0:
        return Risk.SEVERE
    return Risk.NO_TRAVEL


@dataclass(frozen=True)
class Assessment:
    wind: Risk
    rain: Risk
    snow: Risk
    base: Risk
    final: Risk
    dominant: str  # "wind" | "rain" | "snow" | "wind+load" | "none"
    load_override: bool
    reason: str

    def as_dict(self) -> dict:
        return {
            "levels": {"wind": int(self.wind), "rain": int(self.rain), "snow": int(self.snow)},
            "base_level": int(self.base),
            "level": int(self.final),
            "dominant": self.dominant,
            "load_override": self.load_override,
            "reason": self.reason,
        }


def apply_load_rules(base: Risk, wind_mph: float, load_lb: float) -> Risk:
    """Load rules only ever raise the risk."""
    level = base
    if wind_mph >= 55 or wind_mph >= 45 and load_lb > LOAD_NO_TRAVEL_LB:
        level = Risk.NO_TRAVEL
    elif wind_mph >= 35 and load_lb > LOAD_SEVERE_LB:
        level = max(level, Risk.SEVERE)
    return Risk(max(level, base))


def _fmt_lb(lb: float) -> str:
    return f"{int(round(lb)):,} lb"


def classify(wind_mph: float, rain_in: float, snow_in: float, load_lb: float) -> Assessment:
    w, r, s = wind_level(wind_mph), rain_level(rain_in), snow_level(snow_in)
    base = Risk(max(w, r, s))
    final = apply_load_rules(base, wind_mph, load_lb)
    override = final > base

    # dominant factor: highest level; ties broken wind > snow > rain (wind drives load rules)
    if override:
        dominant = "wind+load"
    elif base == Risk.LOW and wind_mph < 15 and rain_in < 0.02 and snow_in < 0.05:
        dominant = "none"
    else:
        dominant = max((("wind", w), ("snow", s), ("rain", r)), key=lambda kv: kv[1])[0]

    if override:
        reason = f"Wind {wind_mph:.0f} mph + {_fmt_lb(load_lb)} load → {final.label}"
    elif dominant == "wind":
        reason = f"Wind {wind_mph:.0f} mph → {final.label}"
    elif dominant == "snow":
        reason = f"Snow {snow_in:.2f} in/hr → {final.label}"
    elif dominant == "rain":
        reason = f"Rain {rain_in:.2f} in/hr → {final.label}"
    else:
        reason = "Calm, dry conditions → Low"
    return Assessment(w, r, s, base, final, dominant, override, reason)
