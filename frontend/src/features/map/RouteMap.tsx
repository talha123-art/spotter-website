import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { heatmapBridge } from "@/features/heatmap/heatmapBridge";
import { LIBERTY_STYLE_URL, makeDarkStyle } from "@/lib/map/darkStyle";
import { RISK_LEVELS, UNKNOWN_RISK } from "@/lib/risk";
import { useTripStore } from "@/lib/store";
import type {
  AnalyzedRoute,
  AnalyzeResponse,
  HeatmapPoint,
  HeatmapResponse,
  RiskLevel,
} from "@/lib/types";
import { CheckpointPopover } from "./CheckpointPopover";
import {
  createGhostTruckDom,
  createPrimaryTruckDom,
  type GhostTruckDom,
  type PrimaryTruckDom,
  updateGhostTruckDom,
  updatePrimaryTruckDom,
  updatePrimaryTruckLoadStyle,
} from "./TruckMarker";
import {
  precomputeRouteTable,
  type RouteVertexTuple,
  sampleTruckAtTime,
  type TruckSample,
} from "./truckKinematics";

const LEVEL_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "level"],
  0,
  RISK_LEVELS[0].color,
  1,
  RISK_LEVELS[1].color,
  2,
  RISK_LEVELS[2].color,
  3,
  RISK_LEVELS[3].color,
  4,
  RISK_LEVELS[4].color,
  UNKNOWN_RISK.color,
];

let cachedLibertyLightJson: StyleSpecification | null = null;
let cachedLibertyDarkJson: StyleSpecification | null = null;

async function loadLibertyBaseStyle(): Promise<StyleSpecification> {
  if (cachedLibertyLightJson) {
    return JSON.parse(JSON.stringify(cachedLibertyLightJson));
  }
  const res = await fetch(LIBERTY_STYLE_URL);
  if (!res.ok) {
    throw new Error(`Failed to load OpenFreeMap Liberty style (${res.status})`);
  }
  const json = (await res.json()) as StyleSpecification;
  cachedLibertyLightJson = json;
  return JSON.parse(JSON.stringify(json));
}

function getOrBuildDarkStyle(lightJson: StyleSpecification): {
  style: StyleSpecification;
  usedFallback: boolean;
} {
  try {
    if (!cachedLibertyDarkJson) {
      cachedLibertyDarkJson = makeDarkStyle(lightJson);
    }
    return {
      style: JSON.parse(JSON.stringify(cachedLibertyDarkJson)),
      usedFallback: false,
    };
  } catch (err) {
    console.error(
      "makeDarkStyle failed; falling back to Liberty with CSS canvas filter:",
      err,
    );
    return {
      style: JSON.parse(JSON.stringify(lightJson)),
      usedFallback: true,
    };
  }
}

/**
 * Finds the first symbol (label) layer in OpenFreeMap Liberty so route and heatmap
 * layers can be inserted directly below all city, state, highway, and POI labels.
 */
function findFirstLabelLayerId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  for (const layer of layers) {
    if (layer.type === "symbol" && !layer.id.startsWith("road_one_way")) {
      return layer.id;
    }
  }
  return undefined;
}

function buildSegmentsGeoJson(
  data: AnalyzeResponse | undefined,
  activeId: string | null,
): GeoJSON.FeatureCollection {
  if (!data) return { type: "FeatureCollection", features: [] };
  const features: GeoJSON.Feature[] = [];
  const ordered = [...data.routes].sort((a, b) =>
    a.id === activeId ? 1 : b.id === activeId ? -1 : 0,
  );
  for (const route of ordered) {
    const isSelected = route.id === activeId;
    for (const seg of route.segments) {
      features.push({
        type: "Feature",
        properties: {
          routeId: route.id,
          level: seg.level ?? -1,
          selected: isSelected ? 1 : 0,
        },
        geometry: {
          type: "LineString",
          coordinates: seg.coords,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function buildCheckpointsGeoJson(
  data: AnalyzeResponse | undefined,
  activeId: string | null,
): GeoJSON.FeatureCollection {
  if (!data) return { type: "FeatureCollection", features: [] };
  const route = data.routes.find((r) => r.id === activeId) ?? data.routes[0];
  if (!route) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: route.checkpoints.map((cp) => ({
      type: "Feature",
      properties: {
        routeId: route.id,
        index: cp.index,
        level: cp.level ?? -1,
        symbol:
          cp.level !== null && cp.level in RISK_LEVELS
            ? RISK_LEVELS[cp.level as RiskLevel].symbol
            : "?",
      },
      geometry: {
        type: "Point",
        coordinates: [cp.lng, cp.lat],
      },
    })),
  };
}

function buildEndpointsGeoJson(
  data: AnalyzeResponse | undefined,
): GeoJSON.FeatureCollection {
  if (!data) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "origin", label: "ORIGIN" },
        geometry: {
          type: "Point",
          coordinates: [data.origin.lng, data.origin.lat],
        },
      },
      {
        type: "Feature",
        properties: { kind: "destination", label: "DEST" },
        geometry: {
          type: "Point",
          coordinates: [data.destination.lng, data.destination.lat],
        },
      },
    ],
  };
}

function buildHeatmapGeoJson(
  points: HeatmapPoint[] | undefined,
  discreteHour: number,
): GeoJSON.FeatureCollection {
  if (!points || points.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }
  const features: GeoJSON.Feature[] = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const [lat, lng, risks] = points[i];
    const r = risks[discreteHour] ?? risks[0] ?? 0;
    const level = r < 0 ? 0 : r;
    features[i] = {
      type: "Feature",
      properties: {
        level,
        weight: 0.25 + level * 0.25,
      },
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
    };
  }
  return { type: "FeatureCollection", features };
}

interface PrecomputedRouteEntry {
  route: AnalyzedRoute;
  table: RouteVertexTuple[];
}

interface RouteMapProps {
  analysis: AnalyzeResponse | undefined;
  heatmap: HeatmapResponse | undefined;
}

export default function RouteMap({ analysis, heatmap }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleReadyRef = useRef(false);
  const heatmapPointsRef = useRef<HeatmapPoint[] | undefined>(undefined);
  const lastDiscreteHourRef = useRef<number>(-1);
  const heatmapGeoJsonRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });

  const [cssFilterFallback, setCssFilterFallback] = useState(false);

  const theme = useTripStore((s) => s.theme);
  const selectedRouteId = useTripStore((s) => s.selectedRouteId);
  const hoveredRouteId = useTripStore((s) => s.hoveredRouteId);
  const selectedCheckpoint = useTripStore((s) => s.selectedCheckpoint);
  const heatmapEnabled = useTripStore((s) => s.heatmapEnabled);
  const followTruck = useTripStore((s) => s.followTruck);
  const showGhostTrucks = useTripStore((s) => s.showGhostTrucks);
  const setSelectedRouteId = useTripStore((s) => s.setSelectedRouteId);
  const setSelectedCheckpoint = useTripStore((s) => s.setSelectedCheckpoint);
  const setFollowTruck = useTripStore((s) => s.setFollowTruck);

  const selectedOrRecommendedId =
    selectedRouteId ?? analysis?.recommendation.route_id ?? null;
  const activeRouteId = hoveredRouteId ?? selectedOrRecommendedId;

  // Precompute [cumDistance, cumDuration, lng, lat, bearing] per route ONCE per analysis
  const precomputedRoutes = useMemo<
    Record<string, PrecomputedRouteEntry>
  >(() => {
    if (!analysis) return {};
    const out: Record<string, PrecomputedRouteEntry> = {};
    for (const r of analysis.routes) {
      out[r.id] = {
        route: r,
        table: precomputeRouteTable(r),
      };
    }
    return out;
  }, [analysis]);

  const segmentsGeo = useMemo(
    () => buildSegmentsGeoJson(analysis, activeRouteId),
    [analysis, activeRouteId],
  );
  const checkpointsGeo = useMemo(
    () => buildCheckpointsGeoJson(analysis, selectedOrRecommendedId),
    [analysis, selectedOrRecommendedId],
  );
  const endpointsGeo = useMemo(
    () => buildEndpointsGeoJson(analysis),
    [analysis],
  );

  const themeRef = useRef(theme);
  themeRef.current = theme;
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  const precomputedRef = useRef(precomputedRoutes);
  precomputedRef.current = precomputedRoutes;
  const selectedRouteIdRef = useRef(selectedOrRecommendedId);
  selectedRouteIdRef.current = selectedOrRecommendedId;
  const followTruckRef = useRef(followTruck);
  followTruckRef.current = followTruck;
  const showGhostTrucksRef = useRef(showGhostTrucks);
  showGhostTrucksRef.current = showGhostTrucks;

  const segmentsRef = useRef(segmentsGeo);
  segmentsRef.current = segmentsGeo;
  const checkpointsRef = useRef(checkpointsGeo);
  checkpointsRef.current = checkpointsGeo;
  const endpointsRef = useRef(endpointsGeo);
  endpointsRef.current = endpointsGeo;
  const heatmapEnabledRef = useRef(heatmapEnabled);
  heatmapEnabledRef.current = heatmapEnabled;

  // Imperative refs for Primary Truck & 2 Ghost Truck MapLibre DOM Markers
  const primaryTruckRef = useRef<{
    marker: maplibregl.Marker;
    dom: PrimaryTruckDom;
    attached: boolean;
    routeId: string | null;
    lastSample: TruckSample | null;
  } | null>(null);

  const ghostTrucksRef = useRef<
    {
      marker: maplibregl.Marker;
      dom: GhostTruckDom;
      attached: boolean;
      targetRouteId: string | null;
    }[]
  >([]);

  const syncTruckMarkersAtHour = useCallback(
    (hour: number, forceHud = false) => {
      const map = mapRef.current;
      const data = analysisRef.current;
      const routesMap = precomputedRef.current;
      const primaryId = selectedRouteIdRef.current;

      if (!map || !data || !primaryId || !routesMap[primaryId]) {
        if (primaryTruckRef.current?.attached) {
          primaryTruckRef.current.marker.remove();
          primaryTruckRef.current.attached = false;
        }
        for (const g of ghostTrucksRef.current) {
          if (g.attached) {
            g.marker.remove();
            g.attached = false;
          }
        }
        return;
      }

      if (!primaryTruckRef.current) {
        const dom = createPrimaryTruckDom(data.load_weight_lb, () => {
          const cur = primaryTruckRef.current;
          if (cur?.lastSample?.nearestCheckpoint && cur.routeId) {
            useTripStore.getState().setSelectedCheckpoint({
              routeId: cur.routeId,
              checkpoint: cur.lastSample.nearestCheckpoint,
            });
          }
        });
        const marker = new maplibregl.Marker({
          element: dom.root,
          anchor: "center",
        });
        primaryTruckRef.current = {
          marker,
          dom,
          attached: false,
          routeId: null,
          lastSample: null,
        };
      }

      const elapsedSec = Math.max(0, hour * 3600);
      const departureMs = new Date(data.departure).getTime();

      const primaryEntry = routesMap[primaryId];
      const pState = primaryTruckRef.current;
      if (pState.routeId !== primaryId) {
        pState.dom.currentAngle = null;
        pState.routeId = primaryId;
        forceHud = true;
      }

      const sample = sampleTruckAtTime(
        primaryEntry.table,
        primaryEntry.route.checkpoints,
        elapsedSec,
      );

      if (sample) {
        pState.lastSample = sample;
        pState.marker.setLngLat([sample.lng, sample.lat]);
        if (!pState.attached) {
          pState.marker.addTo(map);
          pState.attached = true;
        }
        updatePrimaryTruckDom(pState.dom, sample, departureMs, forceHud);

        if (followTruckRef.current) {
          const reducedMotion =
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (reducedMotion) {
            map.jumpTo({ center: [sample.lng, sample.lat] });
          } else {
            map.easeTo({
              center: [sample.lng, sample.lat],
              duration: 140,
              easing: (t) => t,
            });
          }
        }
      }

      const otherRoutes = data.routes
        .filter((r) => r.id !== primaryId)
        .slice(0, 2);
      while (ghostTrucksRef.current.length < 2) {
        const idx = ghostTrucksRef.current.length;
        const gDom = createGhostTruckDom(`Alternate route`, () => {
          const target = ghostTrucksRef.current[idx]?.targetRouteId;
          if (target) {
            useTripStore.getState().setSelectedRouteId(target);
          }
        });
        const gMarker = new maplibregl.Marker({
          element: gDom.root,
          anchor: "center",
        });
        ghostTrucksRef.current.push({
          marker: gMarker,
          dom: gDom,
          attached: false,
          targetRouteId: null,
        });
      }

      for (let i = 0; i < ghostTrucksRef.current.length; i++) {
        const gState = ghostTrucksRef.current[i];
        const altRoute = otherRoutes[i];
        if (
          !showGhostTrucksRef.current ||
          !altRoute ||
          !routesMap[altRoute.id]
        ) {
          if (gState.attached) {
            gState.marker.remove();
            gState.attached = false;
          }
          continue;
        }
        const altEntry = routesMap[altRoute.id];
        if (gState.targetRouteId !== altRoute.id) {
          gState.dom.currentAngle = null;
          gState.targetRouteId = altRoute.id;
          gState.dom.root.title = `${altRoute.label} ghost truck (click to select route)`;
        }
        const gSample = sampleTruckAtTime(
          altEntry.table,
          altEntry.route.checkpoints,
          elapsedSec,
        );
        if (gSample) {
          gState.marker.setLngLat([gSample.lng, gSample.lat]);
          if (!gState.attached) {
            gState.marker.addTo(map);
            gState.attached = true;
          }
          updateGhostTruckDom(gState.dom, gSample);
        }
      }
    },
    [],
  );

  /**
   * Restores all custom sources and layers in exact order, inserting route and heatmap
   * layers BEFORE the first symbol (label) layer so city/state/highway names remain readable
   * on top of routes, and applies theme-aware halo/opacity values.
   */
  const restoreAppLayers = useCallback(
    (map: maplibregl.Map) => {
      const isDark = themeRef.current === "dark";
      const beforeLabelId = findFirstLabelLayerId(map);

      if (!map.getSource("corridor-heat")) {
        map.addSource("corridor-heat", {
          type: "geojson",
          data: heatmapGeoJsonRef.current,
        });
      }
      if (!map.getLayer("corridor-heat-layer")) {
        map.addLayer(
          {
            id: "corridor-heat-layer",
            type: "heatmap",
            source: "corridor-heat",
            layout: {
              visibility: heatmapEnabledRef.current ? "visible" : "none",
            },
            paint: {
              "heatmap-weight": ["get", "weight"],
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                3,
                isDark ? 0.72 : 0.85,
                8,
                isDark ? 1.4 : 1.65,
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                3,
                22,
                7,
                38,
                10,
                52,
              ],
              "heatmap-opacity": isDark ? 0.56 : 0.68,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(16, 185, 129, 0)",
                0.2,
                "rgba(16, 185, 129, 0.45)",
                0.45,
                "rgba(234, 179, 8, 0.65)",
                0.7,
                "rgba(249, 115, 22, 0.82)",
                0.88,
                "rgba(239, 68, 68, 0.92)",
                1,
                "rgba(147, 51, 234, 0.96)",
              ],
            },
          },
          beforeLabelId,
        );
      } else {
        map.setPaintProperty(
          "corridor-heat-layer",
          "heatmap-opacity",
          isDark ? 0.56 : 0.68,
        );
      }

      if (!map.getLayer("corridor-dots-layer")) {
        map.addLayer(
          {
            id: "corridor-dots-layer",
            type: "circle",
            source: "corridor-heat",
            layout: {
              visibility: heatmapEnabledRef.current ? "visible" : "none",
            },
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                3,
                3.5,
                8,
                6.5,
              ],
              "circle-color": LEVEL_COLOR_EXPR,
              "circle-opacity": isDark ? 0.46 : 0.56,
              "circle-stroke-width": 0.6,
              "circle-stroke-color": isDark ? "#090d16" : "#ffffff",
            },
          },
          beforeLabelId,
        );
      } else {
        map.setPaintProperty(
          "corridor-dots-layer",
          "circle-opacity",
          isDark ? 0.46 : 0.56,
        );
        map.setPaintProperty(
          "corridor-dots-layer",
          "circle-stroke-color",
          isDark ? "#090d16" : "#ffffff",
        );
      }

      if (!map.getSource("route-segments")) {
        map.addSource("route-segments", {
          type: "geojson",
          data: segmentsRef.current,
        });
      }
      if (!map.getLayer("routes-dimmed")) {
        map.addLayer(
          {
            id: "routes-dimmed",
            type: "line",
            source: "route-segments",
            filter: ["==", ["get", "selected"], 0],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": LEVEL_COLOR_EXPR,
              "line-width": 4,
              "line-opacity": 0.44,
            },
          },
          beforeLabelId,
        );
      }

      // Theme-aware route halo: white in light mode, near-black outline in dark mode
      const haloColor = isDark ? "#090d16" : "#ffffff";
      if (!map.getLayer("routes-selected-halo")) {
        map.addLayer(
          {
            id: "routes-selected-halo",
            type: "line",
            source: "route-segments",
            filter: ["==", ["get", "selected"], 1],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": haloColor,
              "line-width": 10.5,
              "line-opacity": 0.94,
            },
          },
          beforeLabelId,
        );
      } else {
        map.setPaintProperty("routes-selected-halo", "line-color", haloColor);
      }

      if (!map.getLayer("routes-selected")) {
        map.addLayer(
          {
            id: "routes-selected",
            type: "line",
            source: "route-segments",
            filter: ["==", ["get", "selected"], 1],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": LEVEL_COLOR_EXPR,
              "line-width": 6,
              "line-opacity": 1,
            },
          },
          beforeLabelId,
        );
      }
      if (!map.getLayer("routes-no-travel-dash")) {
        map.addLayer(
          {
            id: "routes-no-travel-dash",
            type: "line",
            source: "route-segments",
            filter: ["==", ["get", "level"], 4],
            layout: { "line-cap": "butt", "line-join": "round" },
            paint: {
              "line-color": "#f5d0fe",
              "line-width": 2.5,
              "line-dasharray": [2, 2],
            },
          },
          beforeLabelId,
        );
      }

      if (!map.getSource("checkpoints")) {
        map.addSource("checkpoints", {
          type: "geojson",
          data: checkpointsRef.current,
        });
      }
      if (!map.getLayer("checkpoints-circle")) {
        map.addLayer(
          {
            id: "checkpoints-circle",
            type: "circle",
            source: "checkpoints",
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                3,
                5.5,
                8,
                8.5,
              ],
              "circle-color": LEVEL_COLOR_EXPR,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          },
          beforeLabelId,
        );
      }

      if (!map.getSource("endpoints")) {
        map.addSource("endpoints", {
          type: "geojson",
          data: endpointsRef.current,
        });
      }
      if (!map.getLayer("endpoints-circle")) {
        map.addLayer(
          {
            id: "endpoints-circle",
            type: "circle",
            source: "endpoints",
            paint: {
              "circle-radius": 9,
              "circle-color": [
                "match",
                ["get", "kind"],
                "origin",
                "#10b981",
                "#0ea5e9",
              ],
              "circle-stroke-width": 3,
              "circle-stroke-color": "#ffffff",
            },
          },
          beforeLabelId,
        );
      }

      styleReadyRef.current = true;
      (
        map.getSource("route-segments") as maplibregl.GeoJSONSource | undefined
      )?.setData(segmentsRef.current);
      (
        map.getSource("checkpoints") as maplibregl.GeoJSONSource | undefined
      )?.setData(checkpointsRef.current);
      (
        map.getSource("endpoints") as maplibregl.GeoJSONSource | undefined
      )?.setData(endpointsRef.current);
      (
        map.getSource("corridor-heat") as maplibregl.GeoJSONSource | undefined
      )?.setData(heatmapGeoJsonRef.current);
      syncTruckMarkersAtHour(heatmapBridge.getHour(), true);
    },
    [syncTruckMarkersAtHour],
  );

  // Initialize MapLibre instance once using OpenFreeMap Liberty for both light and dark modes
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: LIBERTY_STYLE_URL,
      center: [-96.5, 40.5],
      zoom: 4.3,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: false }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true }),
      "top-right",
    );

    let mapLoaded = false;

    // Preload both Light and Dark Liberty styles into memory so theme toggles are synchronous (<25ms)
    loadLibertyBaseStyle()
      .then((lightJson) => {
        if (cancelled || !mapRef.current) return;
        const { style: darkStyle, usedFallback } =
          getOrBuildDarkStyle(lightJson);
        if (mapLoaded && themeRef.current === "dark") {
          setCssFilterFallback(usedFallback);
          map.setStyle(darkStyle, { diff: true });
          restoreAppLayers(map);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch Liberty JSON for dark transform:", err);
        if (themeRef.current === "dark") {
          setCssFilterFallback(true);
        }
      });

    map.on("load", () => {
      mapLoaded = true;
      if (!cachedLibertyLightJson) {
        const current = map.getStyle();
        if (current) {
          cachedLibertyLightJson = JSON.parse(JSON.stringify(current));
        }
      }
      if (themeRef.current === "dark" && cachedLibertyLightJson) {
        const { style, usedFallback } = getOrBuildDarkStyle(
          cachedLibertyLightJson,
        );
        setCssFilterFallback(usedFallback);
        map.setStyle(style, { diff: true });
      }
      restoreAppLayers(map);
    });

    map.on("style.load", () => {
      if (mapLoaded) {
        restoreAppLayers(map);
      }
    });

    map.on("styledata", () => {
      if (mapLoaded && !map.getLayer("routes-selected")) {
        restoreAppLayers(map);
      }
    });

    const disableFollowOnUserGesture = (e: { originalEvent?: Event }) => {
      if (e.originalEvent && followTruckRef.current) {
        setFollowTruck(false);
      }
    };
    map.on("dragstart", disableFollowOnUserGesture);
    map.on("touchstart", disableFollowOnUserGesture);
    map.on("wheel", disableFollowOnUserGesture);

    map.on("click", "routes-dimmed", (e) => {
      const feat = e.features?.[0];
      const rid = feat?.properties?.routeId;
      if (rid) setSelectedRouteId(String(rid));
    });

    map.on("click", "checkpoints-circle", (e) => {
      const feat = e.features?.[0];
      if (!feat) return;
      const rid = String(feat.properties?.routeId ?? "");
      const idx = Number(feat.properties?.index ?? -1);
      const route = analysisRef.current?.routes.find((r) => r.id === rid);
      const cp = route?.checkpoints.find((c) => c.index === idx);
      if (route && cp) {
        setSelectedCheckpoint({ routeId: route.id, checkpoint: cp });
      }
    });

    for (const layerId of ["routes-dimmed", "checkpoints-circle"]) {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    mapRef.current = map;
    (window as unknown as { __rgMap?: maplibregl.Map }).__rgMap = map;
    const ghostSnapshot = ghostTrucksRef.current;
    return () => {
      cancelled = true;
      primaryTruckRef.current?.marker.remove();
      primaryTruckRef.current = null;
      for (const g of ghostSnapshot) {
        g.marker.remove();
      }
      ghostTrucksRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fast diff-based theme switch (<50ms, no tile reload, camera & playback preserved)
  const prevThemeRef = useRef(theme);
  useEffect(() => {
    if (prevThemeRef.current === theme) return;
    prevThemeRef.current = theme;
    const map = mapRef.current;
    if (!map) return;

    const applyThemeStyle = (lightJson: StyleSpecification) => {
      if (!mapRef.current) return;
      if (theme === "dark") {
        const { style, usedFallback } = getOrBuildDarkStyle(lightJson);
        setCssFilterFallback(usedFallback);
        map.setStyle(style, { diff: true });
      } else {
        setCssFilterFallback(false);
        map.setStyle(JSON.parse(JSON.stringify(lightJson)), { diff: true });
      }
      restoreAppLayers(map);
    };

    if (cachedLibertyLightJson) {
      try {
        applyThemeStyle(cachedLibertyLightJson);
      } catch (err) {
        console.error("Theme style switch fallback activated:", err);
        setCssFilterFallback(theme === "dark");
        restoreAppLayers(map);
      }
      return;
    }

    loadLibertyBaseStyle()
      .then(applyThemeStyle)
      .catch((err) => {
        console.error("Theme style switch fallback activated:", err);
        setCssFilterFallback(theme === "dark");
        restoreAppLayers(map);
      });
  }, [theme, restoreAppLayers]);

  // Apply CSS filter fallback ONLY to the base WebGL canvas element if makeDarkStyle threw
  useEffect(() => {
    const canvas = containerRef.current?.querySelector<HTMLCanvasElement>(
      ".maplibregl-canvas-container canvas.maplibregl-canvas",
    );
    if (!canvas) return;
    if (theme === "dark" && cssFilterFallback) {
      canvas.style.filter =
        "invert(1) hue-rotate(180deg) saturate(0.7) brightness(0.9)";
    } else {
      canvas.style.filter = "";
    }
  }, [theme, cssFilterFallback]);

  // Update route segments & checkpoints sources when data or selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const segSrc = map.getSource("route-segments") as
      maplibregl.GeoJSONSource | undefined;
    segSrc?.setData(segmentsGeo);
    const cpSrc = map.getSource("checkpoints") as
      maplibregl.GeoJSONSource | undefined;
    cpSrc?.setData(checkpointsGeo);
    const epSrc = map.getSource("endpoints") as
      maplibregl.GeoJSONSource | undefined;
    epSrc?.setData(endpointsGeo);
  }, [segmentsGeo, checkpointsGeo, endpointsGeo]);

  // Re-sync truck markers whenever analysis, selected route, load weight, ghost toggle, or follow toggle changes
  useEffect(() => {
    if (analysis && primaryTruckRef.current) {
      updatePrimaryTruckLoadStyle(
        primaryTruckRef.current.dom,
        analysis.load_weight_lb,
      );
    }
    syncTruckMarkersAtHour(heatmapBridge.getHour(), true);
  }, [
    analysis,
    precomputedRoutes,
    selectedOrRecommendedId,
    showGhostTrucks,
    followTruck,
    syncTruckMarkersAtHour,
  ]);

  // Fit bounds when a new analysis arrives
  const lastGeneratedAtRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !analysis ||
      analysis.generated_at === lastGeneratedAtRef.current
    )
      return;
    lastGeneratedAtRef.current = analysis.generated_at;

    const bounds = new maplibregl.LngLatBounds();
    for (const r of analysis.routes) {
      for (const [lng, lat] of r.geometry) {
        bounds.extend([lng, lat]);
      }
    }
    if (!bounds.isEmpty()) {
      const reducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      )?.matches;
      map.fitBounds(bounds, {
        padding: { top: 80, right: 140, bottom: 170, left: 540 },
        duration: reducedMotion ? 0 : 900,
      });
    }
  }, [analysis]);

  // Build initial heatmap GeoJSON when heatmap response changes, and subscribe to 60fps bridge
  useEffect(() => {
    heatmapPointsRef.current = heatmap?.points;
    const dHour = heatmapBridge.getDiscreteHour();
    lastDiscreteHourRef.current = dHour;
    const initialGeo = buildHeatmapGeoJson(heatmap?.points, dHour);
    heatmapGeoJsonRef.current = initialGeo;

    const map = mapRef.current;
    if (map && styleReadyRef.current) {
      const src = map.getSource("corridor-heat") as
        maplibregl.GeoJSONSource | undefined;
      src?.setData(initialGeo);
    }
  }, [heatmap]);

  useEffect(() => {
    return heatmapBridge.subscribe((hour) => {
      syncTruckMarkersAtHour(hour, false);

      const dHour = Math.round(hour);
      if (dHour === lastDiscreteHourRef.current) return;
      lastDiscreteHourRef.current = dHour;

      const pts = heatmapPointsRef.current;
      const geo = heatmapGeoJsonRef.current;
      if (!pts || geo.features.length !== pts.length) return;
      for (let i = 0; i < pts.length; i++) {
        const risks = pts[i][2];
        const raw = risks[dHour] ?? risks[0] ?? 0;
        const level = raw < 0 ? 0 : raw;
        const props = geo.features[i].properties!;
        props.level = level;
        props.weight = 0.25 + level * 0.25;
      }
      const map = mapRef.current;
      if (map && styleReadyRef.current) {
        const src = map.getSource("corridor-heat") as
          maplibregl.GeoJSONSource | undefined;
        src?.setData(geo);
      }
    });
  }, [syncTruckMarkersAtHour]);

  // Toggle heatmap layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const vis = heatmapEnabled ? "visible" : "none";
    if (map.getLayer("corridor-heat-layer")) {
      map.setLayoutProperty("corridor-heat-layer", "visibility", vis);
    }
    if (map.getLayer("corridor-dots-layer")) {
      map.setLayoutProperty("corridor-dots-layer", "visibility", vis);
    }
  }, [heatmapEnabled]);

  const activeRoute = analysis?.routes.find(
    (r) => r.id === selectedCheckpoint?.routeId,
  );

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label="Interactive truck route and weather risk map"
      />

      {selectedCheckpoint && activeRoute && (
        <div className="pointer-events-auto absolute right-4 top-16 z-30">
          <CheckpointPopover
            routeLabel={activeRoute.label}
            checkpoint={selectedCheckpoint.checkpoint}
            onClose={() => setSelectedCheckpoint(null)}
          />
        </div>
      )}
    </div>
  );
}
