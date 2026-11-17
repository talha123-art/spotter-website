import pytest

from apps.risk.rules import Risk, apply_load_rules, classify, rain_level, snow_level, wind_level

L, M, H, S, N = Risk.LOW, Risk.MODERATE, Risk.HIGH, Risk.SEVERE, Risk.NO_TRAVEL


@pytest.mark.parametrize(
    "mph,expected",
    [
        (0, L),
        (24.9, L),
        (25, M),
        (34.9, M),
        (35, H),
        (44.9, H),
        (45, S),
        (54.9, S),
        (55, N),
        (80, N),
    ],
)
def test_wind_thresholds(mph, expected):
    assert wind_level(mph) == expected


@pytest.mark.parametrize(
    "inch,expected",
    [
        (0, L),
        (0.09, L),
        (0.099, L),
        (0.10, M),
        (0.24, M),
        (0.25, H),
        (0.49, H),
        (0.50, S),
        (1.00, S),
        (1.001, N),
        (1.01, N),
    ],
)
def test_rain_thresholds(inch, expected):
    assert rain_level(inch) == expected


@pytest.mark.parametrize(
    "inch,expected",
    [
        (0, L),
        (0.49, L),
        (0.5, M),
        (0.99, M),
        (1.0, H),
        (1.99, H),
        (2.0, S),
        (3.0, S),
        (3.01, N),
    ],
)
def test_snow_thresholds(inch, expected):
    assert snow_level(inch) == expected


def test_checkpoint_risk_is_max_of_conditions():
    a = classify(wind_mph=10, rain_in=0.3, snow_in=0.6, load_lb=0)
    assert (a.wind, a.rain, a.snow) == (L, H, M)
    assert a.final == H
    assert a.dominant == "rain"
    assert a.reason == "Rain 0.30 in/hr → High"


def test_dominant_tie_prefers_wind():
    a = classify(wind_mph=36, rain_in=0.3, snow_in=0, load_lb=0)
    assert a.final == H and a.dominant == "wind"


def test_calm_conditions():
    a = classify(5, 0, 0, 80_000)
    assert a.final == L and a.dominant == "none" and not a.load_override
    assert a.reason == "Calm, dry conditions → Low"


# ---------------------------------------------------------------- load rules
@pytest.mark.parametrize("load", [0, 20_000, 30_000, 40_000, 80_000])
def test_wind_55_is_no_travel_for_any_load(load):
    assert classify(55, 0, 0, load).final == N


@pytest.mark.parametrize(
    "wind,load,expected,override",
    [
        (45, 30_000, S, False),
        (45, 30_001, N, True),
        (54.9, 30_000, S, False),
        (54.9, 30_001, N, True),
        (44.9, 30_001, H, False),  # below 45: 30k rule does not apply, 40k rule not triggered
        (35, 40_000, H, False),
        (35, 40_001, S, True),
        (44.9, 40_000, H, False),
        (44.9, 40_001, S, True),
        (34.9, 40_001, M, False),
        (45, 40_001, N, True),  # 45+ & >30k wins over the 40k rule
    ],
)
def test_load_rules(wind, load, expected, override):
    a = classify(wind, 0, 0, load)
    assert a.final == expected
    assert a.load_override is override


def test_load_rule_never_lowers_risk():
    # snow already No Travel; load rule for 35-44 mph would give Severe; must stay No Travel
    a = classify(wind_mph=40, rain_in=0, snow_in=3.5, load_lb=45_000)
    assert a.final == N
    assert apply_load_rules(N, 40, 45_000) == N


def test_load_override_reason_text():
    a = classify(47, 0, 0, 42_000)
    assert a.final == N
    assert a.dominant == "wind+load"
    assert a.reason == "Wind 47 mph + 42,000 lb load → No Travel"


def test_40k_rule_reason():
    a = classify(38, 0, 0, 40_001)
    assert a.reason == "Wind 38 mph + 40,001 lb load → Severe"


def test_as_dict_shape():
    d = classify(30, 0.1, 0, 0).as_dict()
    assert d["levels"] == {"wind": 1, "rain": 1, "snow": 0}
    assert d["level"] == 1
