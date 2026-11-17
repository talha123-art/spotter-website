"""Typed API errors: 400 invalid input, 422 no route, 429 throttled, 502 upstream failure."""

from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.exceptions import APIException, Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler

from apps.routing.providers import NoRouteError
from common.http import UpstreamError

log = logging.getLogger(__name__)


def _body(code: str, message: str, **extra) -> dict:
    return {"error": {"code": code, "message": message, **extra}}


def handler(exc, context):
    if isinstance(exc, NoRouteError):
        return Response(
            _body("no_route", f"No drivable route found between these places. {exc}".strip()),
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if isinstance(exc, UpstreamError):
        log.warning("upstream failure: %s", exc)
        msg = (
            f"{exc.service} is rate-limiting requests right now. Please retry in a minute."
            if exc.rate_limited
            else f"{exc.service} (free public service) is slow or unavailable. Please retry shortly."
        )
        return Response(
            _body("upstream_unavailable", msg, service=exc.service, rate_limited=exc.rate_limited),
            status=status.HTTP_502_BAD_GATEWAY,
        )
    if isinstance(exc, ValidationError):
        return Response(_body("invalid", "Invalid request.", fields=exc.detail), status=status.HTTP_400_BAD_REQUEST)
    if isinstance(exc, Throttled):
        resp = Response(
            _body("throttled", f"Too many requests. Try again in {int(exc.wait or 1)} s.", retry_after=exc.wait),
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
        if exc.wait:
            resp["Retry-After"] = str(int(exc.wait))
        return resp
    if isinstance(exc, APIException):
        resp = exception_handler(exc, context)
        if resp is not None:
            resp.data = _body(getattr(exc, "default_code", "error"), str(exc.detail))
        return resp
    log.exception("unhandled error", exc_info=exc)
    return Response(_body("server_error", "Unexpected server error."), status=status.HTTP_500_INTERNAL_SERVER_ERROR)
