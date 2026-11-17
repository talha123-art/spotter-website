from datetime import UTC, datetime, timedelta

import pytest

from apps.weather.interpolate import HourlySeries, interpolate_at

T0 = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)


def series(n=3, wind=(10, 20, 40)):
    times = [int((T0 + timedelta(hours=i)).timestamp()) for i in range(n)]
    return HourlySeries(
        times=times,
        values={
            "wind_mph": list(wind),
            "gust_mph": [w + 10 for w in wind],
            "rain_in": [0.0, 0.2, 0.0],
            "snow_in": [0.0, 0.0, 1.0],
            "precip_in": [0.0, 0.2, 1.0],
        },
    )


def test_exact_hour():
    s = interpolate_at(series(), T0 + timedelta(hours=1))
    assert s.wind_mph == 20 and s.rain_in == 0.2


def test_linear_between_hours():
    s = interpolate_at(series(), T0 + timedelta(minutes=90))
    assert s.wind_mph == pytest.approx(30)
    assert s.rain_in == pytest.approx(0.1)
    assert s.snow_in == pytest.approx(0.5)
    assert s.gust_mph == pytest.approx(40)


def test_quarter_hour():
    s = interpolate_at(series(), T0 + timedelta(minutes=15))
    assert s.wind_mph == pytest.approx(12.5)


def test_last_hour_inclusive():
    assert interpolate_at(series(), T0 + timedelta(hours=2)).wind_mph == 40


def test_out_of_range_returns_none():
    assert interpolate_at(series(), T0 + timedelta(hours=2, minutes=1)) is None
    assert interpolate_at(series(), T0 - timedelta(minutes=1)) is None
    assert interpolate_at(None, T0) is None


def test_missing_values_unavailable():
    s = series()
    s.values["wind_mph"][1] = None
    assert interpolate_at(s, T0 + timedelta(minutes=30)) is None


def test_timezone_aware_non_utc_input():
    from zoneinfo import ZoneInfo

    local = (T0 + timedelta(minutes=90)).astimezone(ZoneInfo("America/Chicago"))
    assert interpolate_at(series(), local).wind_mph == pytest.approx(30)
