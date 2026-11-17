"""Geocoding providers (autocomplete): Photon -> Nominatim -> mock fixtures."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from pathlib import Path
from typing import Protocol, TypedDict

import httpx
from django.conf import settings
from django.core.cache import cache

from common.http import UpstreamError, request_json

log = logging.getLogger(__name__)

GEOCODE_TTL = 24 * 3600


class Place(TypedDict):
    label: str
    name: str
    detail: str
    lat: float
    lng: float


class GeocodingProvider(Protocol):
    name: str

    async def search(self, client: httpx.AsyncClient, q: str, limit: int) -> list[Place]: ...


def _join(*parts: str | None) -> str:
    seen: list[str] = []
    for p in parts:
        if p and p not in seen:
            seen.append(p)
    return ", ".join(seen)


class PhotonProvider:
    name = "photon"

    async def search(self, client: httpx.AsyncClient, q: str, limit: int) -> list[Place]:
        data = await request_json(
            client,
            "Photon",
            "GET",
            f"{settings.PHOTON_BASE_URL.rstrip('/')}/api/",
            params={"q": q, "limit": limit, "lang": "en"},
            retries=1,
        )
        out: list[Place] = []
        for f in data.get("features", []):
            pr = f.get("properties", {})
            lng, lat = f["geometry"]["coordinates"][:2]
            name = pr.get("name") or pr.get("street") or pr.get("city") or q
            detail = _join(pr.get("city") if pr.get("city") != name else None, pr.get("state"), pr.get("country"))
            out.append(Place(label=_join(name, detail), name=name, detail=detail, lat=lat, lng=lng))
        return out


_nominatim_lock = threading.Lock()
_nominatim_next = 0.0


class NominatimProvider:
    """Respects the 1 request/second usage policy process-wide."""

    name = "nominatim"

    async def search(self, client: httpx.AsyncClient, q: str, limit: int) -> list[Place]:
        global _nominatim_next
        with _nominatim_lock:
            now = time.monotonic()
            slot = max(now, _nominatim_next)
            _nominatim_next = slot + 1.0
        if slot > now:
            await asyncio.sleep(slot - now)
        data = await request_json(
            client,
            "Nominatim",
            "GET",
            f"{settings.NOMINATIM_BASE_URL.rstrip('/')}/search",
            params={"q": q, "format": "jsonv2", "limit": limit, "addressdetails": 1},
            retries=0,
        )
        out: list[Place] = []
        for r in data:
            addr = r.get("address", {})
            name = r.get("name") or r.get("display_name", q).split(",")[0]
            detail = _join(addr.get("city") or addr.get("town"), addr.get("state"), addr.get("country"))
            out.append(
                Place(label=_join(name, detail), name=name, detail=detail, lat=float(r["lat"]), lng=float(r["lon"]))
            )
        return out


FIXTURE = Path(__file__).resolve().parent.parent.parent / "fixtures" / "places.json"


class MockGeocodingProvider:
    name = "mock"

    def __init__(self) -> None:
        with FIXTURE.open(encoding="utf-8") as f:
            self.places: list[Place] = json.load(f)

    async def search(self, client: httpx.AsyncClient | None, q: str, limit: int) -> list[Place]:
        ql = q.lower().strip()
        starts = [p for p in self.places if p["name"].lower().startswith(ql)]
        contains = [p for p in self.places if ql in p["label"].lower() and p not in starts]
        return (starts + contains)[:limit]


def provider_chain() -> list[GeocodingProvider]:
    if settings.USE_MOCKS:
        return [MockGeocodingProvider()]
    chain: list[GeocodingProvider] = [PhotonProvider(), NominatimProvider()]
    if settings.ALLOW_MOCK_FALLBACK:
        chain.append(MockGeocodingProvider())
    return chain


async def geocode(client: httpx.AsyncClient, q: str, limit: int = 5) -> tuple[list[Place], str]:
    key = f"geo:v1:{int(settings.USE_MOCKS)}:{limit}:{q.strip().lower()}"
    cached = cache.get(key)
    if cached is not None:
        return cached["r"], cached["p"]
    last: UpstreamError | None = None
    for p in provider_chain():
        try:
            res = await p.search(client, q, limit)
        except UpstreamError as exc:
            log.warning("geocoder %s failed: %s", p.name, exc)
            last = exc
            continue
        if p.name != "mock":
            cache.set(key, {"r": res, "p": p.name}, GEOCODE_TTL)
        return res, p.name
    assert last is not None
    raise last
