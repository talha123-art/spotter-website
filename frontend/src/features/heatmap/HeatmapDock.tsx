import {
  Crosshair,
  Eye,
  EyeOff,
  Flame,
  Pause,
  Play,
  StepBack,
  StepForward,
  Truck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RiskLegend } from "@/components/ui/RiskLegend";
import { formatEtaLocal } from "@/lib/format";
import { useTripStore } from "@/lib/store";
import type { AnalyzedRoute, HeatmapResponse } from "@/lib/types";
import { heatmapBridge } from "./heatmapBridge";

interface HeatmapDockProps {
  heatmap: HeatmapResponse | undefined;
  isLoading: boolean;
  departureIso: string | undefined;
  activeRoute?: AnalyzedRoute;
}

export function HeatmapDock({
  heatmap,
  isLoading,
  departureIso,
  activeRoute,
}: HeatmapDockProps) {
  const heatmapEnabled = useTripStore((s) => s.heatmapEnabled);
  const setHeatmapEnabled = useTripStore((s) => s.setHeatmapEnabled);
  const setHeatmapHourDisplay = useTripStore((s) => s.setHeatmapHourDisplay);
  const followTruck = useTripStore((s) => s.followTruck);
  const setFollowTruck = useTripStore((s) => s.setFollowTruck);
  const showGhostTrucks = useTripStore((s) => s.showGhostTrucks);
  const setShowGhostTrucks = useTripStore((s) => s.setShowGhostTrucks);

  const maxHour = heatmap ? Math.max(0, heatmap.hours - 1) : 48;
  const departureMs = departureIso
    ? new Date(departureIso).getTime()
    : heatmap
      ? new Date(heatmap.base_time).getTime()
      : Date.now();

  const sliderRef = useRef<HTMLInputElement>(null);
  const offsetLabelRef = useRef<HTMLSpanElement>(null);
  const timeLabelRef = useRef<HTMLSpanElement>(null);
  const mobileHudRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef<number>(heatmapBridge.getHour());
  const throttleTimerRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);

  const formatLabels = useCallback(
    (hour: number) => {
      const ts = new Date(departureMs + hour * 3600 * 1000).toISOString();
      const rounded = Math.round(hour);
      if (offsetLabelRef.current) {
        offsetLabelRef.current.textContent = `+${rounded}h from departure`;
      }
      if (timeLabelRef.current) {
        timeLabelRef.current.textContent = formatEtaLocal(ts);
      }
      if (mobileHudRef.current && activeRoute) {
        const totalHr = activeRoute.duration_s / 3600;
        const pct = totalHr > 0 ? Math.min(1, Math.max(0, hour / totalHr)) : 0;
        const covered = Math.round(activeRoute.distance_mi * pct);
        const rem = Math.max(0, Math.round(activeRoute.distance_mi - covered));
        mobileHudRef.current.textContent =
          hour >= totalHr
            ? `Arrived · ${Math.round(activeRoute.distance_mi)} mi`
            : `${covered} mi covered · ${rem} mi left`;
      }
    },
    [departureMs, activeRoute],
  );

  const applyHour = useCallback(
    (nextHour: number) => {
      const clamped = Math.max(0, Math.min(maxHour, nextHour));
      hourRef.current = clamped;
      if (sliderRef.current) {
        sliderRef.current.value = String(clamped);
      }
      formatLabels(clamped);
      heatmapBridge.setHour(clamped);

      // Throttle Zustand display state (~5 Hz = 200ms) so React does not re-render at 60fps
      if (throttleTimerRef.current === null) {
        throttleTimerRef.current = window.setTimeout(() => {
          throttleTimerRef.current = null;
          setHeatmapHourDisplay(Math.round(hourRef.current));
        }, 200);
      }
    },
    [formatLabels, maxHour, setHeatmapHourDisplay],
  );

  useEffect(() => {
    formatLabels(hourRef.current);
  }, [formatLabels]);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  // 60fps requestAnimationFrame playback loop (or discrete jump if reduced motion is preferred)
  useEffect(() => {
    if (!playing) return;
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      const id = window.setInterval(() => {
        const next =
          hourRef.current >= maxHour ? 0 : Math.floor(hourRef.current) + 1;
        applyHour(next);
      }, 500);
      return () => window.clearInterval(id);
    }

    let rafId = 0;
    let lastTs = performance.now();
    const HOURS_PER_SECOND = 2.4;

    const tick = (now: number) => {
      const dtSec = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      let next = hourRef.current + dtSec * HOURS_PER_SECOND;
      if (next > maxHour) {
        next = 0;
      }
      applyHour(next);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [playing, maxHour, applyHour]);

  return (
    <section
      aria-label="Corridor weather forecast timeline"
      className="pointer-events-auto mx-auto w-full max-w-4xl rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 py-2.5 shadow-2xl backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setHeatmapEnabled(!heatmapEnabled)}
            aria-pressed={heatmapEnabled}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
              heatmapEnabled
                ? "bg-sky-600 text-white shadow-sm"
                : "border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {heatmapEnabled ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            <span>Corridor Heatmap</span>
          </button>

          <button
            type="button"
            onClick={() => setShowGhostTrucks(!showGhostTrucks)}
            aria-pressed={showGhostTrucks}
            title="Show faint comparison trucks on the other two routes at the same timestamp"
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
              showGhostTrucks
                ? "bg-indigo-600 text-white shadow-sm"
                : "border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            <Truck className="h-3.5 w-3.5" />
            <span>Ghost trucks</span>
          </button>

          <button
            type="button"
            onClick={() => setFollowTruck(!followTruck)}
            aria-pressed={followTruck}
            title="Ease camera to keep the selected truck centered during playback (auto-disables on map drag)"
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
              followTruck
                ? "bg-emerald-600 text-white shadow-sm"
                : "border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            <Crosshair className="h-3.5 w-3.5" />
            <span>Follow truck</span>
          </button>

          <div className="flex items-center gap-2 text-xs tabular-nums">
            <span
              ref={offsetLabelRef}
              data-testid="heatmap-offset-label"
              className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-sky-700 dark:bg-slate-800 dark:text-sky-300"
            >
              +{Math.round(hourRef.current)}h from departure
            </span>
            <span
              ref={timeLabelRef}
              data-testid="heatmap-time-label"
              className="hidden text-slate-600 sm:inline dark:text-slate-300"
            >
              {formatEtaLocal(
                new Date(
                  departureMs + hourRef.current * 3600 * 1000,
                ).toISOString(),
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLoading && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300">
              <Flame className="h-3.5 w-3.5 animate-pulse" />
              Loading 48h grid…
            </span>
          )}
          <RiskLegend compact />
        </div>
      </div>

      {/* Collapsed mobile HUD strip */}
      {activeRoute && (
        <div
          ref={mobileHudRef}
          data-testid="mobile-truck-hud"
          className="mt-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium tabular-nums text-sky-700 md:hidden dark:bg-slate-800/80 dark:text-sky-300"
        />
      )}

      {/* Controls + 0-48h Slider */}
      <div className="mt-2 flex items-center gap-2.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Step back 1 hour"
            onClick={() => {
              setPlaying(false);
              applyHour(Math.round(hourRef.current) - 1);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <StepBack className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            aria-label={
              playing ? "Pause forecast playback" : "Play 48-hour forecast"
            }
            onClick={() => setPlaying((p) => !p)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white hover:bg-sky-500"
          >
            {playing ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            aria-label="Step forward 1 hour"
            onClick={() => {
              setPlaying(false);
              applyHour(Math.round(hourRef.current) + 1);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <StepForward className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col">
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={maxHour}
            step="any"
            defaultValue={hourRef.current}
            aria-label="Forecast hour offset from departure (0 to 48 hours)"
            onChange={(e) => applyHour(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-sky-500 dark:bg-slate-800"
          />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-400">
            <span>0h (Depart)</span>
            <span>+12h</span>
            <span>+24h</span>
            <span>+36h</span>
            <span>+48h</span>
          </div>
        </div>
      </div>
    </section>
  );
}
