import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  Info,
  Loader2,
  Moon,
  RefreshCw,
  ServerCrash,
  Sun,
  Truck,
} from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { HeatmapDock } from "@/features/heatmap/HeatmapDock";
import { CompareTable } from "@/features/routes/CompareTable";
import { RecommendationBanner } from "@/features/routes/RecommendationBanner";
import { RouteCard } from "@/features/routes/RouteCard";
import { TripForm } from "@/features/trip-form/TripForm";
import { ApiError, analyzeTrip, fetchHeatmap } from "@/lib/api";
import { DEFAULT_DESTINATION, DEFAULT_ORIGIN, useTripStore } from "@/lib/store";
import type { AnalyzeRequest } from "@/lib/types";

const LazyRouteMap = lazy(() => import("@/features/map/RouteMap"));

export function App() {
  const {
    theme,
    toggleTheme,
    selectedRouteId,
    setSelectedRouteId,
    setHoveredRouteId,
    compareOpen,
    setCompareOpen,
    panelCollapsed,
    setPanelCollapsed,
    mobileSheetExpanded,
    setMobileSheetExpanded,
    departureLocal,
    loadWeightLb,
    interval,
  } = useTripStore();

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const [submittedReq, setSubmittedReq] = useState<AnalyzeRequest>(() => ({
    origin: {
      lat: DEFAULT_ORIGIN.lat,
      lng: DEFAULT_ORIGIN.lng,
      label: DEFAULT_ORIGIN.label,
    },
    destination: {
      lat: DEFAULT_DESTINATION.lat,
      lng: DEFAULT_DESTINATION.lng,
      label: DEFAULT_DESTINATION.label,
    },
    departure: new Date(departureLocal).toISOString(),
    load_weight_lb: loadWeightLb,
    interval,
  }));

  const analyzeQuery = useQuery({
    queryKey: ["analyze", submittedReq],
    queryFn: ({ signal }) => analyzeTrip(submittedReq, signal),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const heatmapQuery = useQuery({
    queryKey: [
      "heatmap",
      submittedReq.origin,
      submittedReq.destination,
      submittedReq.departure,
      submittedReq.load_weight_lb,
    ],
    queryFn: ({ signal }) =>
      fetchHeatmap(
        {
          origin: submittedReq.origin,
          destination: submittedReq.destination,
          departure: submittedReq.departure,
          load_weight_lb: submittedReq.load_weight_lb,
        },
        signal,
      ),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  // Select recommended route whenever new analysis arrives
  useEffect(() => {
    if (analyzeQuery.data) {
      setSelectedRouteId(analyzeQuery.data.recommendation.route_id);
    }
  }, [analyzeQuery.data, setSelectedRouteId]);

  // Show "Waking up server..." cold-start banner if loading exceeds 2.2 seconds
  const [coldStartNotice, setColdStartNotice] = useState(false);
  useEffect(() => {
    if (!analyzeQuery.isFetching) {
      setColdStartNotice(false);
      return;
    }
    const id = window.setTimeout(() => setColdStartNotice(true), 2200);
    return () => window.clearTimeout(id);
  }, [analyzeQuery.isFetching]);

  const analysis = analyzeQuery.data;
  const activeRouteId =
    selectedRouteId ?? analysis?.recommendation.route_id ?? null;
  const activeRoute = analysis?.routes.find((r) => r.id === activeRouteId);
  const error = analyzeQuery.error as ApiError | Error | null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Full-screen MapLibre canvas */}
      <main className="h-full w-full">
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-sky-500" />
              <span className="text-sm">Initializing vector map…</span>
            </div>
          }
        >
          <LazyRouteMap analysis={analysis} heatmap={heatmapQuery.data} />
        </Suspense>
      </main>

      {/* Top status bar: Cold start notice + upstream warnings */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-4">
        {coldStartNotice && (
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-sky-500/40 bg-slate-900/95 px-4 py-1.5 text-xs text-sky-200 shadow-lg backdrop-blur"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
            <span>
              Waking up server & sampling corridor weather — cold starts take
              ~15–30s…
            </span>
          </div>
        )}

        {analysis && analysis.warnings.length > 0 && (
          <div
            role="status"
            className="pointer-events-auto flex max-w-xl items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-950/90 px-3.5 py-2 text-xs text-amber-100 shadow-lg backdrop-blur"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>{analysis.warnings.join(" ")}</span>
          </div>
        )}
      </div>

      {/* Left floating panel (desktop collapsible; mobile bottom-sheet) */}
      <aside
        aria-label="Route planner and risk analysis"
        className={`pointer-events-auto absolute z-20 flex flex-col transition-all duration-200 ${
          panelCollapsed
            ? "left-4 top-4 w-auto"
            : "inset-x-0 bottom-0 max-h-[82vh] rounded-t-2xl md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:max-h-none md:w-[400px] md:rounded-2xl"
        } border border-slate-200/90 bg-white/95 shadow-2xl backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95`}
      >
        {/* Header bar */}
        <header className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white shadow-sm">
              <Truck className="h-4 w-4" />
            </div>
            {!panelCollapsed && (
              <div>
                <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                  RouteGuard Freight
                </h1>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Weather & Load-Aware Truck Routing
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>

            {/* Mobile sheet expand/collapse */}
            <button
              type="button"
              onClick={() => setMobileSheetExpanded(!mobileSheetExpanded)}
              aria-label={
                mobileSheetExpanded ? "Minimize panel" : "Expand panel"
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 md:hidden dark:border-slate-800 dark:text-slate-300"
            >
              {mobileSheetExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>

            {/* Desktop collapse button */}
            <button
              type="button"
              onClick={() => setPanelCollapsed(!panelCollapsed)}
              aria-label={
                panelCollapsed ? "Expand side panel" : "Collapse side panel"
              }
              title={
                panelCollapsed ? "Expand side panel" : "Collapse side panel"
              }
              className="hidden h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 md:inline-flex dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {panelCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        {!panelCollapsed && (
          <div
            className={`flex-1 space-y-4 overflow-y-auto p-4 ${
              mobileSheetExpanded
                ? "max-h-[72vh]"
                : "max-h-[38vh] md:max-h-none"
            }`}
          >
            <TripForm
              onSubmit={(req) => setSubmittedReq(req)}
              isLoading={analyzeQuery.isFetching}
            />

            {/* Loading skeleton state */}
            {analyzeQuery.isPending && (
              <div
                role="status"
                aria-label="Loading route analysis"
                className="space-y-2.5 pt-2"
              >
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-100 p-3 dark:border-slate-800 dark:bg-slate-800/50"
                  />
                ))}
              </div>
            )}

            {/* Friendly Error state with Retry */}
            {analyzeQuery.isError && (
              <div
                role="alert"
                className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-800 dark:text-red-200"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <ServerCrash className="h-4 w-4 shrink-0 text-red-500" />
                  <span>
                    {error instanceof ApiError && error.code === "no_route"
                      ? "No Drivable Route Found"
                      : error instanceof ApiError && error.rateLimited
                        ? "Upstream Service Rate-Limited"
                        : "Unable to Analyze Routes"}
                  </span>
                </div>
                <p className="mt-1 text-red-700/90 dark:text-red-200/90">
                  {error?.message ||
                    "A free upstream routing or weather server did not respond."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    analyzeQuery.refetch();
                    heatmapQuery.refetch();
                  }}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Retry request</span>
                </button>
              </div>
            )}

            {/* Results */}
            {analysis && (
              <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                <RecommendationBanner rec={analysis.recommendation} />

                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    3 Routes · Checkpoints every {analysis.interval_mi} mi
                  </div>
                  <button
                    type="button"
                    onClick={() => setCompareOpen(!compareOpen)}
                    aria-pressed={compareOpen}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
                      compareOpen
                        ? "bg-sky-600 text-white"
                        : "border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    <Columns3 className="h-3.5 w-3.5" />
                    <span>Compare</span>
                  </button>
                </div>

                {compareOpen && (
                  <CompareTable
                    routes={analysis.routes}
                    selectedId={activeRouteId}
                    onSelect={(id) => setSelectedRouteId(id)}
                  />
                )}

                <div className="space-y-2.5">
                  {analysis.routes.map((route) => (
                    <RouteCard
                      key={route.id}
                      route={route}
                      selected={route.id === activeRouteId}
                      onSelect={() => setSelectedRouteId(route.id)}
                      onHover={(hovered) =>
                        setHoveredRouteId(hovered ? route.id : null)
                      }
                    />
                  ))}
                </div>

                {/* Checkpoint list quick inspector for keyboard accessibility */}
                {activeRoute && (
                  <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-900/60">
                    <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">
                      Inspect {activeRoute.checkpoints.length} checkpoints on{" "}
                      {activeRoute.label}
                    </summary>
                    <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1 tabular-nums">
                      {activeRoute.checkpoints.map((cp) => (
                        <li key={cp.index}>
                          <button
                            type="button"
                            onClick={() =>
                              useTripStore.getState().setSelectedCheckpoint({
                                routeId: activeRoute.id,
                                checkpoint: cp,
                              })
                            }
                            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-slate-200/70 dark:hover:bg-slate-800"
                          >
                            <span>
                              #{cp.index + 1} · {Math.round(cp.distance_mi)} mi
                            </span>
                            <span className="truncate pl-2 text-[11px] text-slate-500 dark:text-slate-400">
                              {cp.reason}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    Routing: {analysis.providers.routing} · Weather:{" "}
                    {analysis.providers.weather}
                  </span>
                  <span>Click any map dot for details</span>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Bottom timeline/slider dock */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 hidden px-4 md:left-[420px] md:block">
        <HeatmapDock
          heatmap={heatmapQuery.data}
          isLoading={heatmapQuery.isFetching}
          departureIso={submittedReq.departure}
          activeRoute={activeRoute}
        />
      </div>
    </div>
  );
}
