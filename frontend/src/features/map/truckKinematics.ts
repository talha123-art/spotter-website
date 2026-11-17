import type { AnalyzedRoute, Checkpoint, RiskLevel } from "@/lib/types";

const EARTH_RADIUS_MI = 3958.7613;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * [cumDistanceMi, cumDurationSec, lng, lat, bearingDeg]
 */
export type RouteVertexTuple = [number, number, number, number, number];

export interface TruckSample {
  lng: number;
  lat: number;
  bearing: number;
  distanceMi: number;
  remainingMi: number;
  totalDistanceMi: number;
  elapsedSec: number;
  totalDurationSec: number;
  status: "origin" | "en_route" | "arrived";
  nearestCheckpoint: Checkpoint | null;
  riskLevel: RiskLevel | null;
  forecastAvailable: boolean;
}

export function haversineMi(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const rLat1 = lat1 * DEG_TO_RAD;
  const rLat2 = lat2 * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Forward compass bearing in degrees [0, 360), where 0 = North, 90 = East.
 */
export function bearingDeg(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLambda = (lng2 - lng1) * DEG_TO_RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  if (x === 0 && y === 0) return 0;
  return (((Math.atan2(y, x) * RAD_TO_DEG) % 360) + 360) % 360;
}

/**
 * Signed shortest angular difference in [-180, 180] from `fromDeg` to `toDeg`.
 */
export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  const diff = ((toDeg - fromDeg + 540) % 360) - 180;
  return diff === -180 ? 180 : diff;
}

/**
 * Interpolates between two compass angles along the shortest arc, normalized to [0, 360).
 */
export function lerpAngleDeg(
  fromDeg: number,
  toDeg: number,
  t: number,
): number {
  const delta = shortestAngleDelta(fromDeg, toDeg);
  return (((fromDeg + delta * t) % 360) + 360) % 360;
}

function interpolateElapsedAtDistance(
  checkpoints: Checkpoint[],
  distanceMi: number,
  fallbackTotalMi: number,
  fallbackDurationSec: number,
): number {
  const n = checkpoints.length;
  if (n === 0) {
    return fallbackTotalMi > 0
      ? (distanceMi / fallbackTotalMi) * fallbackDurationSec
      : 0;
  }
  if (distanceMi <= checkpoints[0].distance_mi) {
    return checkpoints[0].elapsed_s;
  }
  if (distanceMi >= checkpoints[n - 1].distance_mi) {
    return checkpoints[n - 1].elapsed_s;
  }
  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (checkpoints[mid].distance_mi <= distanceMi) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = checkpoints[lo];
  const b = checkpoints[hi];
  const span = b.distance_mi - a.distance_mi;
  const t = span <= 0 ? 0 : (distanceMi - a.distance_mi) / span;
  return a.elapsed_s + (b.elapsed_s - a.elapsed_s) * t;
}

/**
 * Precomputes [cumDistanceMi, cumDurationSec, lng, lat, bearingDeg] per vertex once per route.
 * Uses the checkpoint ETA curve (distance_mi -> elapsed_s) so truck progress matches
 * variable segment speeds rather than a constant average speed.
 */
export function precomputeRouteTable(
  route: Pick<
    AnalyzedRoute,
    "geometry" | "checkpoints" | "distance_mi" | "duration_s"
  >,
): RouteVertexTuple[] {
  const coords = route.geometry;
  const n = coords.length;
  if (n === 0) return [];

  const rawCum = new Array<number>(n);
  rawCum[0] = 0;
  for (let i = 1; i < n; i++) {
    rawCum[i] =
      rawCum[i - 1] +
      haversineMi(
        coords[i - 1][0],
        coords[i - 1][1],
        coords[i][0],
        coords[i][1],
      );
  }
  const rawTotal = rawCum[n - 1];
  const targetTotal = route.distance_mi > 0 ? route.distance_mi : rawTotal;
  const scale = rawTotal > 0 ? targetTotal / rawTotal : 1;

  const table: RouteVertexTuple[] = new Array(n);
  let lastBearing = 0;

  for (let i = 0; i < n; i++) {
    const cumDist = rawCum[i] * scale;
    const cumDur = interpolateElapsedAtDistance(
      route.checkpoints,
      cumDist,
      targetTotal,
      route.duration_s,
    );

    // Look slightly ahead along the polyline for a stable forward bearing
    let lookIdx = Math.min(n - 1, i + 1);
    while (lookIdx < n - 1 && rawCum[lookIdx] - rawCum[i] < 0.15) {
      lookIdx++;
    }
    let brg = lastBearing;
    if (
      lookIdx > i &&
      (coords[lookIdx][0] !== coords[i][0] ||
        coords[lookIdx][1] !== coords[i][1])
    ) {
      brg = bearingDeg(
        coords[i][0],
        coords[i][1],
        coords[lookIdx][0],
        coords[lookIdx][1],
      );
      lastBearing = brg;
    }

    table[i] = [cumDist, cumDur, coords[i][0], coords[i][1], brg];
  }

  return table;
}

export function findNearestCheckpoint(
  checkpoints: Checkpoint[],
  distanceMi: number,
): Checkpoint | null {
  const n = checkpoints.length;
  if (n === 0) return null;
  if (n === 1 || distanceMi <= checkpoints[0].distance_mi)
    return checkpoints[0];
  if (distanceMi >= checkpoints[n - 1].distance_mi) return checkpoints[n - 1];

  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (checkpoints[mid].distance_mi <= distanceMi) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return distanceMi - checkpoints[lo].distance_mi <=
    checkpoints[hi].distance_mi - distanceMi
    ? checkpoints[lo]
    : checkpoints[hi];
}

/**
 * O(log N) binary-search lookup of the truck's position, heading, and nearest checkpoint
 * at `elapsedSec` seconds after departure.
 */
export function sampleTruckAtTime(
  table: RouteVertexTuple[],
  checkpoints: Checkpoint[],
  elapsedSec: number,
): TruckSample | null {
  const n = table.length;
  if (n === 0) return null;

  const first = table[0];
  const last = table[n - 1];
  const totalDistanceMi = last[0];
  const totalDurationSec = last[1];

  let lng: number;
  let lat: number;
  let bearing: number;
  let distanceMi: number;
  let status: TruckSample["status"];

  if (elapsedSec <= 0 || totalDurationSec <= 0) {
    distanceMi = 0;
    lng = first[2];
    lat = first[3];
    bearing = first[4];
    status = "origin";
  } else if (elapsedSec >= totalDurationSec) {
    distanceMi = totalDistanceMi;
    lng = last[2];
    lat = last[3];
    bearing = last[4];
    status = "arrived";
  } else {
    let lo = 0;
    let hi = n - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (table[mid][1] <= elapsedSec) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const a = table[lo];
    const b = table[hi];
    const span = b[1] - a[1];
    const t = span <= 0 ? 0 : (elapsedSec - a[1]) / span;
    distanceMi = a[0] + (b[0] - a[0]) * t;
    lng = a[2] + (b[2] - a[2]) * t;
    lat = a[3] + (b[3] - a[3]) * t;
    bearing = lerpAngleDeg(a[4], b[4], t);
    status = "en_route";
  }

  const remainingMi = Math.max(0, totalDistanceMi - distanceMi);
  const nearestCheckpoint = findNearestCheckpoint(checkpoints, distanceMi);
  const forecastAvailable = nearestCheckpoint
    ? nearestCheckpoint.forecast_available
    : false;
  const riskLevel =
    nearestCheckpoint && nearestCheckpoint.forecast_available
      ? nearestCheckpoint.level
      : null;

  return {
    lng,
    lat,
    bearing,
    distanceMi,
    remainingMi,
    totalDistanceMi,
    elapsedSec: Math.max(0, elapsedSec),
    totalDurationSec,
    status,
    nearestCheckpoint,
    riskLevel,
    forecastAvailable,
  };
}
