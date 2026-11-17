from datetime import UTC, datetime, timedelta

from rest_framework import serializers

MAX_LOAD_LB = 150_000


class PointSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(required=False, allow_blank=True, max_length=300)


class TripSerializer(serializers.Serializer):
    origin = PointSerializer()
    destination = PointSerializer()
    departure = serializers.DateTimeField(default_timezone=UTC)
    load_weight_lb = serializers.IntegerField(min_value=0, max_value=MAX_LOAD_LB)

    def validate_departure(self, value: datetime) -> datetime:
        now = datetime.now(UTC)
        if value < now - timedelta(hours=6):
            raise serializers.ValidationError("Departure cannot be more than 6 hours in the past.")
        if value > now + timedelta(days=30):
            raise serializers.ValidationError("Departure must be within the next 30 days.")
        return value

    def validate(self, attrs):
        o, d = attrs["origin"], attrs["destination"]
        if abs(o["lat"] - d["lat"]) < 1e-4 and abs(o["lng"] - d["lng"]) < 1e-4:
            raise serializers.ValidationError({"destination": "Destination must differ from origin."})
        return attrs


class AnalyzeSerializer(TripSerializer):
    interval = serializers.ChoiceField(choices=["10", "25", "50", "auto"], default="25")

    def to_internal_value(self, data):
        if isinstance(data, dict) and isinstance(data.get("interval"), int):
            data = {**data, "interval": str(data["interval"])}
        return super().to_internal_value(data)


class HeatmapSerializer(TripSerializer):
    pass


class GeocodeQuerySerializer(serializers.Serializer):
    q = serializers.CharField(min_length=2, max_length=200, trim_whitespace=True)
    limit = serializers.IntegerField(min_value=1, max_value=10, default=5)
