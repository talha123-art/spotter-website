from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.routing.providers import decode_polyline6, get_three_routes
from apps.weather.providers import OpenMeteoProvider
from common.http import make_client

CHICAGO = {"lat": 41.8781, "lng": -87.6298}
DENVER = {"lat": 39.7392, "lng": -104.9903}


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


def _dep_iso(hours_ahead: float = 1) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours_ahead)).isoformat()


# ---------------------------------------------------------------- mock mode e2e


def test_health_endpoint(settings):
    settings.DEBUG = False
    r = APIClient().get("/api/health", HTTP_HOST="spotter-api.onrender.com")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_geocode_mock_and_validation(settings):
    settings.USE_MOCKS = True
    c = APIClient()
    assert c.get("/api/geocode?q=x").status_code == 400
    r = c.get("/api/geocode?q=chic")
    assert r.status_code == 200
    data = r.json()
    assert data["provider"] == "mock"
    assert data["results"][0]["name"] == "Chicago"


def test_analyze_mock_returns_three_routes_and_load_override(settings):
    settings.USE_MOCKS = True
    c = APIClient()
    # Heavy load: triggers No Travel on the central Nebraska storm and load override on Kansas band
    r_heavy = c.post(
        "/api/analyze",
        {
            "origin": CHICAGO,
            "destination": DENVER,
            "departure": _dep_iso(1),
            "load_weight_lb": 42_000,
            "interval": "auto",
        },
        format="json",
    )
    assert r_heavy.status_code == 200
    body = r_heavy.json()
    assert len(body["routes"]) == 3
    assert body["interval_mi"] == 50  # ~920 mi > 800 -> 50
    assert {r["label"] for r in body["routes"]} == {"Fastest", "Alternative A", "Alternative B"}
    assert sum(1 for r in body["routes"] if r["recommended"]) == 1
    assert body["recommendation"]["route_id"] == body["routes"][0]["id"]
    # fastest goes straight through the Nebraska 61 mph storm -> No Travel
    by_id = {r["id"]: r for r in body["routes"]}
    assert by_id["fastest"]["metrics"]["no_travel_checkpoints"] >= 1
    assert body["recommendation"]["route_id"] != "fastest"


def test_analyze_load_weight_changes_risk_and_reason(settings):
    settings.USE_MOCKS = True
    c = APIClient()
    # Route through Kansas band (~50 mph wind): light load -> Severe; >30k lb -> No Travel override
    payload = {
        "origin": {"lat": 39.10, "lng": -94.58},  # Kansas City
        "destination": {"lat": 39.74, "lng": -104.99},  # Denver
        "departure": _dep_iso(1),
        "interval": 25,
    }
    light = c.post("/api/analyze", {**payload, "load_weight_lb": 10_000}, format="json").json()
    heavy = c.post("/api/analyze", {**payload, "load_weight_lb": 42_000}, format="json").json()
    f_light = next(r for r in light["routes"] if r["id"] == "fastest")
    f_heavy = next(r for r in heavy["routes"] if r["id"] == "fastest")
    assert f_heavy["metrics"]["no_travel_checkpoints"] > f_light["metrics"]["no_travel_checkpoints"]
    assert any(cp["load_override"] and "lb load → No Travel" in cp["reason"] for cp in f_heavy["checkpoints"])


def test_analyze_all_no_travel_scenario(settings):
    settings.USE_MOCKS = True
    c = APIClient()
    # Depart +32h so arrival hits the Front Range blizzard near Denver on all 3 routes
    r = c.post(
        "/api/analyze",
        {"origin": CHICAGO, "destination": DENVER, "departure": _dep_iso(24), "load_weight_lb": 45_000, "interval": 50},
        format="json",
    ).json()
    assert r["recommendation"]["all_have_no_travel"] is True
    assert "No Travel" in r["recommendation"]["explanation"]


def test_analyze_beyond_forecast_marks_unavailable(settings):
    settings.USE_MOCKS = True
    r = (
        APIClient()
        .post(
            "/api/analyze",
            {"origin": CHICAGO, "destination": DENVER, "departure": _dep_iso(24 * 20), "load_weight_lb": 20_000},
            format="json",
        )
        .json()
    )
    cp = r["routes"][0]["checkpoints"][0]
    assert cp["forecast_available"] is False
    assert cp["level"] is None
    assert cp["reason"] == "Forecast unavailable at ETA"


def test_heatmap_endpoint_compact_49_hours(settings):
    settings.USE_MOCKS = True
    r = APIClient().post(
        "/api/heatmap",
        {"origin": CHICAGO, "destination": DENVER, "departure": _dep_iso(1), "load_weight_lb": 40_000},
        format="json",
    )
    assert r.status_code == 200
    b = r.json()
    assert b["hours"] == 49
    assert 30 <= len(b["points"]) <= 300
    lat, lng, risks = b["points"][0]
    assert isinstance(lat, float) and isinstance(lng, float) and len(risks) == 49


def test_validation_and_error_shapes(settings):
    settings.USE_MOCKS = True
    c = APIClient()
    # same origin and destination -> 400
    r = c.post(
        "/api/analyze",
        {"origin": CHICAGO, "destination": CHICAGO, "departure": _dep_iso(1), "load_weight_lb": 1000},
        format="json",
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid"
    # past departure -> 400
    r = c.post(
        "/api/analyze",
        {"origin": CHICAGO, "destination": DENVER, "departure": _dep_iso(-10), "load_weight_lb": 1000},
        format="json",
    )
    assert r.status_code == 400


# ---------------------------------------------------------------- live provider parsing & fallback


def _osrm_route(coords, duration=3600):
    n = len(coords) - 1
    return {
        "duration": duration,
        "distance": 100_000,
        "geometry": {"type": "LineString", "coordinates": coords},
        "legs": [{"annotation": {"duration": [duration / n] * n}, "steps": []}],
    }


@respx.mock
async def test_osrm_single_route_synthesizes_two_alternatives(settings):
    settings.USE_MOCKS = False
    settings.HTTP_RETRIES = 0
    calls = []

    def side_effect(request: httpx.Request):
        calls.append(str(request.url))
        # build a geometry through whatever coordinates were requested
        path = request.url.path.split("/driving/")[1]
        pts = [[float(x) for x in pair.split(",")] for pair in path.split(";")]
        # interpolate 20 vertices so overlap works
        coords = []
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            for k in range(10):
                t = k / 10
                coords.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
        coords.append(pts[-1])
        return httpx.Response(200, json={"code": "Ok", "routes": [_osrm_route(coords, 3600 + len(calls) * 300)]})

    respx.get(url__startswith="https://router.project-osrm.org/route/v1/driving/").mock(side_effect=side_effect)
    async with make_client() as client:
        rs = await get_three_routes(client, (-87.63, 41.88), (-95.93, 41.26))
    assert len(rs.routes) == 3
    assert sum(1 for r in rs.routes if r.synthetic) == 2
    assert len(calls) >= 3


@respx.mock
def test_no_route_returns_422(settings):
    settings.USE_MOCKS = False
    settings.HTTP_RETRIES = 0
    respx.get(url__startswith="https://router.project-osrm.org/").mock(
        return_value=httpx.Response(400, json={"code": "NoRoute", "message": "Impossible route"})
    )
    r = APIClient().post(
        "/api/analyze",
        {"origin": CHICAGO, "destination": {"lat": 21.3, "lng": -157.8}, "departure": _dep_iso(1), "load_weight_lb": 0},
        format="json",
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_route"


@respx.mock
def test_all_upstreams_down_without_mock_fallback_returns_502(settings):
    settings.USE_MOCKS = False
    settings.ALLOW_MOCK_FALLBACK = False
    settings.HTTP_RETRIES = 0
    respx.get(url__startswith="https://router.project-osrm.org/").mock(return_value=httpx.Response(503))
    respx.post("https://valhalla1.openstreetmap.de/route").mock(return_value=httpx.Response(503))
    r = APIClient().post(
        "/api/analyze",
        {"origin": CHICAGO, "destination": DENVER, "departure": _dep_iso(1), "load_weight_lb": 0},
        format="json",
    )
    assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_unavailable"


@respx.mock
async def test_open_meteo_batched_and_cached(settings):
    settings.HTTP_RETRIES = 0
    t0 = int(datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    times = [t0 + 3600 * i for i in range(48)]
    loc_payload = {
        "timezone": "America/Chicago",
        "utc_offset_seconds": -21600,
        "hourly_units": {"snowfall": "inch"},
        "hourly": {
            "time": times,
            "wind_speed_10m": [20.0] * 48,
            "wind_gusts_10m": [28.0] * 48,
            "rain": [0.0] * 48,
            "snowfall": [0.0] * 48,
            "precipitation": [0.0] * 48,
        },
    }
    route = respx.get("https://api.open-meteo.com/v1/forecast").mock(
        return_value=httpx.Response(200, json=[loc_payload, loc_payload])
    )
    p = OpenMeteoProvider()
    start = datetime.fromtimestamp(t0, UTC)
    end = start + timedelta(hours=10)
    async with make_client() as client:
        s1 = await p.hourly(client, [(-87.63, 41.88), (-88.0, 41.5)], start, end)
        s2 = await p.hourly(client, [(-87.63, 41.88), (-88.0, 41.5)], start, end)
    assert route.call_count == 1  # second call fully served from cache
    assert s1[0] is not None and s2[0] is not None


def test_decode_polyline6():
    # Known 2-point polyline6 for (38.5, -120.2) -> (40.7, -120.95) scaled 1e6
    # Encode manually to verify round-trip
    pts = [(-120.2, 38.5), (-120.95, 40.7)]

    def enc(v: int) -> str:
        v = ~(v << 1) if v < 0 else (v << 1)
        out = ""
        while v >= 0x20:
            out += chr((0x20 | (v & 0x1F)) + 63)
            v >>= 5
        return out + chr(v + 63)

    s = enc(round(38.5e6)) + enc(round(-120.2e6)) + enc(round(2.2e6)) + enc(round(-0.75e6))
    decoded = decode_polyline6(s)
    assert decoded[0] == pytest.approx(pts[0])
    assert decoded[1] == pytest.approx(pts[1])
