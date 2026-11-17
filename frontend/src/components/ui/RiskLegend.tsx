import { RISK_LEVELS } from "@/lib/risk";
import type { RiskLevel } from "@/lib/types";

const ORDER: RiskLevel[] = [0, 1, 2, 3, 4];

export function RiskLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div
      role="region"
      aria-label="Weather risk level legend"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
    >
      {ORDER.map((lvl) => {
        const meta = RISK_LEVELS[lvl];
        return (
          <div
            key={lvl}
            className="flex items-center gap-1.5"
            title={meta.description}
          >
            <span
              aria-hidden="true"
              className={`inline-flex h-3 w-3 items-center justify-center rounded-sm text-[9px] font-bold text-white ${meta.dotClass}`}
              style={{ backgroundColor: meta.hatched ? undefined : meta.color }}
            >
              {meta.symbol}
            </span>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {compact ? meta.short : meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
