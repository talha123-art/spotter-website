import { create } from "zustand";
import { defaultDepartureLocalInput } from "./format";
import type { Checkpoint, IntervalOption, Place } from "./types";

export const DEFAULT_ORIGIN: Place = {
  label: "Chicago, Illinois, United States",
  name: "Chicago",
  detail: "Illinois, United States",
  lat: 41.8781,
  lng: -87.6298,
};

export const DEFAULT_DESTINATION: Place = {
  label: "Denver, Colorado, United States",
  name: "Denver",
  detail: "Colorado, United States",
  lat: 39.7392,
  lng: -104.9903,
};

interface TripStore {
  origin: Place | null;
  destination: Place | null;
  departureLocal: string;
  loadWeightLb: number;
  interval: IntervalOption;

  selectedRouteId: string | null;
  hoveredRouteId: string | null;
  selectedCheckpoint: { routeId: string; checkpoint: Checkpoint } | null;

  compareOpen: boolean;
  panelCollapsed: boolean;
  mobileSheetExpanded: boolean;

  heatmapEnabled: boolean;
  /** Throttled hour index for React display only; map uses a direct callback/ref */
  heatmapHourDisplay: number;

  followTruck: boolean;
  showGhostTrucks: boolean;

  theme: "dark" | "light";

  setOrigin: (p: Place | null) => void;
  setDestination: (p: Place | null) => void;
  swapEndpoints: () => void;
  setDepartureLocal: (v: string) => void;
  setLoadWeightLb: (v: number) => void;
  setInterval: (v: IntervalOption) => void;
  setSelectedRouteId: (id: string | null) => void;
  setHoveredRouteId: (id: string | null) => void;
  setSelectedCheckpoint: (
    cp: { routeId: string; checkpoint: Checkpoint } | null,
  ) => void;
  setCompareOpen: (open: boolean) => void;
  setPanelCollapsed: (c: boolean) => void;
  setMobileSheetExpanded: (e: boolean) => void;
  setHeatmapEnabled: (e: boolean) => void;
  setHeatmapHourDisplay: (h: number) => void;
  setFollowTruck: (f: boolean) => void;
  setShowGhostTrucks: (g: boolean) => void;
  toggleTheme: () => void;
}

const initialTheme = (): "dark" | "light" => {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem("wx-theme");
    if (saved === "light" || saved === "dark") return saved;
    if (typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    }
  }
  return "dark";
};

export const useTripStore = create<TripStore>((set) => ({
  origin: DEFAULT_ORIGIN,
  destination: DEFAULT_DESTINATION,
  departureLocal: defaultDepartureLocalInput(),
  loadWeightLb: 42_000,
  interval: "25",

  selectedRouteId: null,
  hoveredRouteId: null,
  selectedCheckpoint: null,

  compareOpen: false,
  panelCollapsed: false,
  mobileSheetExpanded: false,

  heatmapEnabled: true,
  heatmapHourDisplay: 0,

  followTruck: false,
  showGhostTrucks: true,

  theme: initialTheme(),

  setOrigin: (origin) => set({ origin }),
  setDestination: (destination) => set({ destination }),
  swapEndpoints: () =>
    set((s) => ({
      origin: s.destination,
      destination: s.origin,
    })),
  setDepartureLocal: (departureLocal) => set({ departureLocal }),
  setLoadWeightLb: (v) =>
    set({ loadWeightLb: Math.max(0, Math.min(150_000, Math.round(v))) }),
  setInterval: (interval) => set({ interval }),
  setSelectedRouteId: (selectedRouteId) =>
    set({ selectedRouteId, selectedCheckpoint: null }),
  setHoveredRouteId: (hoveredRouteId) => set({ hoveredRouteId }),
  setSelectedCheckpoint: (selectedCheckpoint) => set({ selectedCheckpoint }),
  setCompareOpen: (compareOpen) => set({ compareOpen }),
  setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
  setMobileSheetExpanded: (mobileSheetExpanded) => set({ mobileSheetExpanded }),
  setHeatmapEnabled: (heatmapEnabled) => set({ heatmapEnabled }),
  setHeatmapHourDisplay: (heatmapHourDisplay) => set({ heatmapHourDisplay }),
  setFollowTruck: (followTruck) => set({ followTruck }),
  setShowGhostTrucks: (showGhostTrucks) => set({ showGhostTrucks }),
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") {
        window.localStorage.setItem("wx-theme", next);
      }
      return { theme: next };
    }),
}));
