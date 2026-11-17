import { cn } from "@/lib/format";
import { riskMeta } from "@/lib/risk";
import type { RiskLevel } from "@/lib/types";

interface RiskBadgeProps {
  level: RiskLevel | null | undefined;
  size?: "sm" | "md";
  showSymbol?: boolean;
  className?: string;
}

export function RiskBadge({
  level,
  size = "md",
  showSymbol = true,
  className,
}: RiskBadgeProps) {
  const meta = riskMeta(level);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md font-medium tracking-tight tabular-nums",
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs",
        meta.badgeClass,
        className,
      )}
      aria-label={`Risk level: ${meta.label}`}
    >
      {showSymbol && (
        <span aria-hidden="true" className="text-[10px] leading-none">
          {meta.symbol}
        </span>
      )}
      <span>{meta.label}</span>
    </span>
  );
}
