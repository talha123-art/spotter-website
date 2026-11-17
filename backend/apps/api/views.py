from asgiref.sync import async_to_sync
from django.conf import settings
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.routing.geocoding import geocode

from . import services
from .serializers import AnalyzeSerializer, GeocodeQuerySerializer, HeatmapSerializer


class ScopedView(APIView):
    throttle_classes = [ScopedRateThrottle]


class HealthView(APIView):
    def get(self, request):
        return Response({"status": "ok", "mocks": settings.USE_MOCKS})


class GeocodeView(ScopedView):
    throttle_scope = "geocode"

    def get(self, request):
        s = GeocodeQuerySerializer(data=request.query_params)
        s.is_valid(raise_exception=True)
        results, provider = async_to_sync(self._run)(s.validated_data["q"], s.validated_data["limit"])
        resp = Response({"results": results, "provider": provider})
        resp["Cache-Control"] = "public, max-age=3600"
        return resp

    @staticmethod
    async def _run(q: str, limit: int):
        from common.http import make_client

        async with make_client() as client:
            return await geocode(client, q, limit)


def _trip(v: dict):
    o, d = v["origin"], v["destination"]
    return (o["lng"], o["lat"]), (d["lng"], d["lat"]), v["departure"], v["load_weight_lb"]


class AnalyzeView(ScopedView):
    throttle_scope = "analyze"

    def post(self, request):
        s = AnalyzeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        origin, dest, dep, load = _trip(s.validated_data)
        data = async_to_sync(services.analyze)(origin, dest, dep, load, s.validated_data["interval"])
        return Response(data)


class HeatmapView(ScopedView):
    throttle_scope = "heatmap"

    def post(self, request):
        s = HeatmapSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        origin, dest, dep, load = _trip(s.validated_data)
        return Response(async_to_sync(services.heatmap)(origin, dest, dep, load))
