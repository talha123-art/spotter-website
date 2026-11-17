import { formatDuration } from "@/lib/format";
import type { AnalyzedRoute } from "@/lib/types";

interface CompareTableProps {
  routes: AnalyzedRoute[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CompareTable({
  routes,
  selectedId,
  onSelect,
}: CompareTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white/95 dark:border-slate-800 dark:bg-slate-900/95">
      <table className="w-full text-left text-[11px] tabular-nums">
        <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th className="px-2 py-1.5">Route</th>
            <th className="px-1 py-1.5">Time</th>
            <th className="px-1 py-1.5">Mi</th>
            <th className="px-1 py-1.5 text-purple-600 dark:text-purple-300">
              NoTrv
            </th>
            <th className="px-1 py-1.5 text-red-600 dark:text-red-400">Sev</th>
            <th className="px-1 py-1.5 text-orange-600 dark:text-orange-300">
              High
            </th>
            <th className="px-2 py-1.5 text-right">Avg</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {routes.map((r) => {
            const m = r.metrics;
            const active = r.id === selectedId;
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={`cursor-pointer transition-colors ${
                  active
                    ? "bg-sky-500/15 font-medium"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <td className="px-2 py-1.5 font-medium text-slate-900 dark:text-slate-100">
                  <div className="flex items-center gap-1">
                    <span className="truncate">{r.label}</span>
                    {r.recommended && (
                      <span
                        title="Recommended"
                        className="rounded bg-emerald-500/20 px-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300"
                      >
                        ★
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-1 py-1.5 whitespace-nowrap">
                  {formatDuration(r.duration_s)}
                </td>
                <td className="px-1 py-1.5 whitespace-nowrap">
                  {Math.round(r.distance_mi)}
                </td>
                <td className="px-1 py-1.5 font-semibold whitespace-nowrap">
                  {Math.round(m.miles_by_level[4])}
                </td>
                <td className="px-1 py-1.5 whitespace-nowrap">
                  {Math.round(m.miles_by_level[3])}
                </td>
                <td className="px-1 py-1.5 whitespace-nowrap">
                  {Math.round(m.miles_by_level[2])}
                </td>
                <td className="px-2 py-1.5 text-right font-medium">
                  {m.avg_risk.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
