import { AlertOctagon, CheckCircle2, Sparkles } from "lucide-react";
import type { Recommendation } from "@/lib/types";

export function RecommendationBanner({ rec }: { rec: Recommendation }) {
  return (
    <div className="space-y-2">
      {rec.all_have_no_travel && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-purple-500/60 bg-purple-950/90 p-3 text-xs text-purple-100 shadow-lg"
        >
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-purple-300" />
          <div>
            <div className="font-semibold text-white">
              Warning: All routes contain No Travel segments
            </div>
            <p className="mt-0.5 text-purple-200/90">
              Severe wind or precipitation exceeds safe truck thresholds on
              every corridor. We highlighted the least-exposed route below, but
              delaying departure is strongly recommended.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-xs dark:bg-emerald-950/40">
        <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          <span>Recommendation Reasoning</span>
        </div>
        <p className="mt-1 leading-relaxed text-slate-700 dark:text-slate-200">
          {rec.explanation}
        </p>
        {rec.tradeoff && (
          <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <Sparkles className="h-3 w-3 shrink-0" />
            <span>Trade-off: {rec.tradeoff}</span>
          </p>
        )}
      </div>
    </div>
  );
}
