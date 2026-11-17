import { describe, expect, it } from "vitest";
import {
  bearingDeg,
  lerpAngleDeg,
  precomputeRouteTable,
  sampleTruckAtTime,
  shortestAngleDelta,
} from "@/features/map/truckKinematics";
import type { Checkpoint } from "@/lib/types";

function makeCheckpoint(
  index: number,
  distance_mi: number,
  elapsed_s: number,
  level: 0 | 1 | 2 | 3 | 4 | null = 0,
  forecast_available = true,
): Checkpoint {
  return {
    index,
    distance_mi,
    lat: 40,
    lng: -90 - index,
    eta: new Date(
      Date.UTC(2026, 10, 16, 12, 0, 0) + elapsed_s * 1000,
    ).toISOString(),
    elapsed_s,
    timezone: "America/Chicago",
    forecast_available,
    weather: forecast_available
      ? { wind_mph: 20, gust_mph: 28, rain_in: 0, snow_in: 0, precip_in: 0 }
      : null,
    levels: forecast_available ? { wind: 0, rain: 0, snow: 0 } : null,
    base_level: level,
    level,
    level_label: level === null ? "Unavailable" : "Low",
    dominant: "none",
    load_override: false,
    reason: "Calm conditions",
  };
}

describe("bearingDeg & shortest-angle interpolation", () => {
  it("computes cardinal bearings accurately", () => {
    // Due North
    expect(bearingDeg(-90, 40, -90, 41)).toBeCloseTo(0, 1);
    // Due East
    expect(bearingDeg(-90, 0, -89, 0)).toBeCloseTo(90, 1);
    // Due South
    expect(bearingDeg(-90, 41, -90, 40)).toBeCloseTo(180, 1);
    // Due West
    expect(bearingDeg(-89, 0, -90, 0)).toBeCloseTo(270, 1);
  });

  it("interpolates across the 0/360 degree wrap-around along the shortest arc", () => {
    expect(shortestAngleDelta(350, 10)).toBeCloseTo(20, 5);
    expect(shortestAngleDelta(10, 350)).toBeCloseTo(-20, 5);
    // Halfway between 350 deg and 10 deg is 0 deg (not 180 deg!)
    expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(lerpAngleDeg(350, 10, 0.25)).toBeCloseTo(355, 5);
    expect(lerpAngleDeg(10, 350, 0.25)).toBeCloseTo(5, 5);
  });
});

describe("precomputeRouteTable & sampleTruckAtTime", () => {
  // 3-vertex due-west route of 100 miles:
  // First 50 mi takes 3600s (50 mph); second 50 mi takes 1800s (100 mph), total 5400s
  const geometry: [number, number][] = [
    [-90.0, 40.0],
    [-91.0, 40.0],
    [-92.0, 40.0],
  ];
  const checkpoints: Checkpoint[] = [
    makeCheckpoint(0, 0, 0, 0),
    makeCheckpoint(1, 50, 3600, 3), // Severe at midpoint
    makeCheckpoint(2, 100, 5400, 1),
  ];
  const table = precomputeRouteTable({
    geometry,
    checkpoints,
    distance_mi: 100,
    duration_s: 5400,
  });

  it("anchors truck at origin when t <= 0", () => {
    const s0 = sampleTruckAtTime(table, checkpoints, 0)!;
    expect(s0.status).toBe("origin");
    expect(s0.distanceMi).toBe(0);
    expect(s0.remainingMi).toBeCloseTo(100, 2);
    expect(s0.lng).toBeCloseTo(-90.0, 4);
    expect(s0.lat).toBeCloseTo(40.0, 4);
    expect(s0.bearing).toBeCloseTo(270, 0);
  });

  it("interpolates position using non-constant ETA segment durations at midpoint and three-quarters", () => {
    // At t = 1800s (half of first leg's 3600s), truck has covered 25 miles (NOT 33.3 miles)
    const sQuarter = sampleTruckAtTime(table, checkpoints, 1800)!;
    expect(sQuarter.status).toBe("en_route");
    expect(sQuarter.distanceMi).toBeCloseTo(25, 1);
    expect(sQuarter.lng).toBeCloseTo(-90.5, 2);

    // At t = 3600s, truck is right at checkpoint #1 (50 mi, Severe risk level 3)
    const sMid = sampleTruckAtTime(table, checkpoints, 3600)!;
    expect(sMid.status).toBe("en_route");
    expect(sMid.distanceMi).toBeCloseTo(50, 1);
    expect(sMid.riskLevel).toBe(3);
    expect(sMid.nearestCheckpoint?.index).toBe(1);

    // At t = 4500s (halfway through second leg's 1800s), truck is at 75 miles
    const sThreeQuarter = sampleTruckAtTime(table, checkpoints, 4500)!;
    expect(sThreeQuarter.distanceMi).toBeCloseTo(75, 1);
    expect(sThreeQuarter.lng).toBeCloseTo(-91.5, 2);
  });

  it("parks truck at destination with arrived status at and beyond total duration", () => {
    const sEnd = sampleTruckAtTime(table, checkpoints, 5400)!;
    expect(sEnd.status).toBe("arrived");
    expect(sEnd.distanceMi).toBeCloseTo(100, 2);
    expect(sEnd.remainingMi).toBe(0);
    expect(sEnd.lng).toBeCloseTo(-92.0, 4);

    const sBeyond = sampleTruckAtTime(table, checkpoints, 48 * 3600)!;
    expect(sBeyond.status).toBe("arrived");
    expect(sBeyond.distanceMi).toBeCloseTo(100, 2);
    expect(sBeyond.remainingMi).toBe(0);
    expect(sBeyond.lng).toBeCloseTo(-92.0, 4);
  });

  it("flags forecastAvailable=false and riskLevel=null when nearest checkpoint has no forecast", () => {
    const unavailCps = [
      makeCheckpoint(0, 0, 0, null, false),
      makeCheckpoint(1, 100, 3600, null, false),
    ];
    const t2 = precomputeRouteTable({
      geometry,
      checkpoints: unavailCps,
      distance_mi: 100,
      duration_s: 3600,
    });
    const s = sampleTruckAtTime(t2, unavailCps, 1200)!;
    expect(s.forecastAvailable).toBe(false);
    expect(s.riskLevel).toBeNull();
  });
});
