import {
  AlertTriangle,
  Award,
  Clock,
  Navigation,
  ShieldAlert,
} from "lucide-react";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { formatDuration, formatMiles, formatTimeShort } from "@/lib/format";
import { RISK_LEVELS } from "@/lib/risk";
import type { AnalyzedRoute, RiskLevel } from "@/lib/types";

interface RouteCardProps {
  route: AnalyzedRoute;
  selected: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
}

const LEVELS: RiskLevel[] = [0, 1, 2, 3, 4];

export function RouteCard({
  route,
  selected,
  onSelect,
  onHover,
}: RouteCardProps) {
  const { metrics } = route;
  const totalMiles = Math.max(1, metrics.distance_mi);
  const endTz = route.checkpoints[route.checkpoints.length - 1]?.timezone;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${route.label} route, ${route.recommended ? "Recommended, " : ""}${formatDuration(route.duration_s)}, ${formatMiles(route.distance_mi)}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`group cursor-pointer rounded-xl border p-3.5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
        selected
          ? "border-sky-500 bg-sky-500/10 shadow-md dark:border-sky-400 dark:bg-sky-500/10"
          : "border-slate-200 bg-white/95 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-slate-700"
      }`}
    >
      {/* Top row: label + recommended badge + worst risk */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {route.label}
            </span>
            {route.recommended && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-500/40 dark:text-emerald-300">
                <Award className="h-3 w-3" />
                Recommended
              </span>
            )}
            {route.synthetic && (
              <span
                title="Synthesized via perpendicular midpoint detour because fewer than 3 distinct primary routes were returned"
                className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              >
                Detour
              </span>
            )}
          </div>
        </div>
        <RiskBadge level={metrics.worst_level} size="sm" />
      </div>

      {/* Metrics row: duration, miles, ETA */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-white">
          <Clock className="h-3.5 w-3.5 text-sky-500" />
          {formatDuration(route.duration_s)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Navigation className="h-3.5 w-3.5 text-slate-400" />
          {formatMiles(route.distance_mi)}
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          ETA {formatTimeShort(route.arrival, endTz)}
        </span>
      </div>

      {/* Mini stacked risk bar (miles per level) */}
      <div className="mt-2.5">
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          role="img"
          aria-label={`Risk breakdown: ${LEVELS.map((l) => `${RISK_LEVELS[l].label} ${Math.round(metrics.miles_by_level[l])} mi`).join(", ")}`}
        >
          {LEVELS.map((lvl) => {
            const mi = metrics.miles_by_level[lvl];
            if (mi <= 0) return null;
            const pct = Math.max(2, (mi / totalMiles) * 100);
            const meta = RISK_LEVELS[lvl];
            return (
              <div
                key={lvl}
                style={{
                  width: `${pct}%`,
                  backgroundColor: meta.hatched ? undefined : meta.color,
                }}
                className={meta.hatched ? "hatched-no-travel" : ""}
                title={`${meta.label}: ${formatMiles(mi)}`}
              />
            );
          })}
          {metrics.unknown_miles > 0 && (
            <div
              style={{
                width: `${Math.max(2, (metrics.unknown_miles / totalMiles) * 100)}%`,
              }}
              className="bg-slate-400"
              title={`Forecast unavailable: ${formatMiles(metrics.unknown_miles)}`}
            />
          )}
        </div>

        {/* Miles per level breakdown */}
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            {LEVELS.map((lvl) => {
              const mi = metrics.miles_by_level[lvl];
              if (mi < 0.5) return null;
              const meta = RISK_LEVELS[lvl];
              return (
                <span key={lvl} className="inline-flex items-center gap-1">
                  <span
                    className={`h-2 w-2 rounded-sm ${meta.dotClass}`}
                    style={{
                      backgroundColor: meta.hatched ? undefined : meta.color,
                    }}
                  />
                  <span>
                    {meta.short}: {Math.round(mi)} mi
                  </span>
                </span>
              );
            })}
          </div>
          <span>Avg {metrics.avg_risk.toFixed(2)}</span>
        </div>
      </div>

      {/* One-line summary / reason + badges */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-200/70 pt-2 text-xs dark:border-slate-800">
        <span
          className="truncate text-slate-600 dark:text-slate-300"
          title={route.summary}
        >
          {route.summary}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {metrics.no_travel_checkpoints > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-purple-950/90 px-1.5 py-0.5 text-[10px] font-semibold text-purple-200 ring-1 ring-purple-500/50">
              <ShieldAlert className="h-3 w-3" />
              {metrics.no_travel_checkpoints} No Travel
            </span>
          )}
          {metrics.unavailable_checkpoints > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              Forecast partial
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
