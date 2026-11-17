import { CloudRain, CloudSnow, Scale, Wind, X } from "lucide-react";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { formatEtaLocal, formatMiles } from "@/lib/format";
import type { Checkpoint } from "@/lib/types";

interface CheckpointPopoverProps {
  routeLabel: string;
  checkpoint: Checkpoint;
  onClose: () => void;
}

export function CheckpointPopover({
  routeLabel,
  checkpoint: cp,
  onClose,
}: CheckpointPopoverProps) {
  return (
    <div
      role="dialog"
      aria-label={`Checkpoint at mile ${Math.round(cp.distance_mi)}`}
      className="w-72 rounded-xl border border-slate-200 bg-white/98 p-3.5 text-xs shadow-2xl backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/98 dark:text-slate-100"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {routeLabel} · Checkpoint #{cp.index + 1}
          </div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
            Mile {formatMiles(cp.distance_mi)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <RiskBadge level={cp.level} size="sm" />
          <button
            type="button"
            aria-label="Close checkpoint details"
            onClick={onClose}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-2 rounded-lg bg-slate-100 px-2.5 py-1.5 tabular-nums text-slate-700 dark:bg-slate-800/80 dark:text-slate-200">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">
          Estimated Arrival ({cp.timezone})
        </div>
        <div className="font-medium">{formatEtaLocal(cp.eta, cp.timezone)}</div>
      </div>

      {cp.weather ? (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center tabular-nums">
          <div className="rounded-lg border border-slate-200/80 p-1.5 dark:border-slate-800">
            <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
              <Wind className="h-3 w-3 text-sky-400" />
              <span>Wind</span>
            </div>
            <div className="mt-0.5 font-semibold text-slate-900 dark:text-white">
              {cp.weather.wind_mph.toFixed(0)} mph
            </div>
            <div className="text-[10px] text-slate-400">
              Gust {cp.weather.gust_mph.toFixed(0)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200/80 p-1.5 dark:border-slate-800">
            <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
              <CloudRain className="h-3 w-3 text-blue-400" />
              <span>Rain</span>
            </div>
            <div className="mt-0.5 font-semibold text-slate-900 dark:text-white">
              {cp.weather.rain_in.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400">in/hr</div>
          </div>

          <div className="rounded-lg border border-slate-200/80 p-1.5 dark:border-slate-800">
            <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
              <CloudSnow className="h-3 w-3 text-indigo-300" />
              <span>Snow</span>
            </div>
            <div className="mt-0.5 font-semibold text-slate-900 dark:text-white">
              {cp.weather.snow_in.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400">in/hr</div>
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
          Hourly forecast unavailable at this checkpoint ETA.
        </div>
      )}

      <div className="mt-2.5 flex items-start gap-1.5 border-t border-slate-200 pt-2 text-[11px] dark:border-slate-800">
        {cp.load_override && (
          <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500 dark:text-purple-300" />
        )}
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {cp.reason}
        </span>
      </div>
    </div>
  );
}
