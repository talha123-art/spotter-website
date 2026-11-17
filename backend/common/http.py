"""Shared async HTTP helpers: descriptive UA, 8 s timeout, exponential backoff."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
from typing import Any

import httpx
from django.conf import settings

log = logging.getLogger(__name__)

RETRY_STATUS = {429, 500, 502, 503, 504}


class UpstreamError(Exception):
    def __init__(self, service: str, message: str, status: int | None = None, rate_limited: bool = False):
        super().__init__(f"{service}: {message}")
        self.service = service
        self.status = status
        self.rate_limited = rate_limited


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"User-Agent": settings.HTTP_USER_AGENT, "Accept": "application/json"},
        timeout=httpx.Timeout(settings.HTTP_TIMEOUT_S),
        follow_redirects=True,
    )


async def request_json(
    client: httpx.AsyncClient,
    service: str,
    method: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: Any = None,
    retries: int | None = None,
    ok_statuses: tuple[int, ...] = (200,),
) -> Any:
    retries = settings.HTTP_RETRIES if retries is None else retries
    last: UpstreamError | None = None
    for attempt in range(retries + 1):
        try:
            resp = await client.request(method, url, params=params, json=json_body)
            if resp.status_code in ok_statuses:
                return resp.json()
            last = UpstreamError(
                service, f"HTTP {resp.status_code}: {resp.text[:200]}", resp.status_code, resp.status_code == 429
            )
            if resp.status_code not in RETRY_STATUS:
                raise last
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last = UpstreamError(service, f"{type(exc).__name__}: {exc}")
        except ValueError as exc:  # bad JSON
            last = UpstreamError(service, f"invalid JSON: {exc}")
        if attempt < retries:
            delay = 0.5 * (2**attempt) + random.uniform(0, 0.2)
            log.warning("%s attempt %d failed (%s); retrying in %.1fs", service, attempt + 1, last, delay)
            await asyncio.sleep(delay)
    assert last is not None
    raise last


def stable_hash(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:24]
