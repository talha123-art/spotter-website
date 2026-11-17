import type { RiskLevel } from "./types";

export interface RiskMeta {
  level: RiskLevel;
  label: string;
  short: string;
  /** Colorblind-safe (Okabe-Ito / Viridis-inspired) high-contrast hex used on map & bars */
  color: string;
  stroke: string;
  badgeClass: string;
  dotClass: string;
  hatched?: boolean;
  symbol: string;
  description: string;
}

export const RISK_LEVELS: Record<RiskLevel, RiskMeta> = {
  0: {
    level: 0,
    label: "Low",
    short: "LOW",
    color: "#10b981", // emerald-500
    stroke: "#047857",
    badgeClass:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/35",
    dotClass: "bg-emerald-500",
    symbol: "●",
    description: "Wind <25 mph · Rain <0.10 in/hr · Snow <0.5 in/hr",
  },
  1: {
    level: 1,
    label: "Moderate",
    short: "MOD",
    color: "#eab308", // yellow-500
    stroke: "#a16207",
    badgeClass:
      "bg-yellow-500/15 text-yellow-800 dark:text-yellow-200 ring-1 ring-yellow-500/40",
    dotClass: "bg-yellow-500",
    symbol: "▲",
    description: "Wind 25–34 mph · Rain 0.10–0.24 in/hr · Snow 0.5–0.9 in/hr",
  },
  2: {
    level: 2,
    label: "High",
    short: "HIGH",
    color: "#f97316", // orange-500
    stroke: "#c2410c",
    badgeClass:
      "bg-orange-500/15 text-orange-800 dark:text-orange-200 ring-1 ring-orange-500/40",
    dotClass: "bg-orange-500",
    symbol: "◆",
    description: "Wind 35–44 mph · Rain 0.25–0.49 in/hr · Snow 1.0–1.9 in/hr",
  },
  3: {
    level: 3,
    label: "Severe",
    short: "SEV",
    color: "#ef4444", // red-500
    stroke: "#991b1b",
    badgeClass:
      "bg-red-500/15 text-red-800 dark:text-red-200 ring-1 ring-red-500/45",
    dotClass: "bg-red-500",
    symbol: "■",
    description:
      "Wind 45–54 mph (or 35–44 mph w/ >40k lb) · Rain 0.50–1.00 in/hr · Snow 2.0–3.0 in/hr",
  },
  4: {
    level: 4,
    label: "No Travel",
    short: "NO TRAVEL",
    color: "#9333ea", // purple-600 on near-black
    stroke: "#3b0764",
    badgeClass:
      "bg-purple-950/90 text-purple-100 ring-1 ring-purple-400/60 hatched-no-travel font-semibold",
    dotClass: "bg-purple-600 hatched-no-travel",
    hatched: true,
    symbol: "✕",
    description:
      "Wind ≥55 mph (or 45–54 mph w/ >30k lb) · Rain >1.00 in/hr · Snow >3.0 in/hr",
  },
};

export const UNKNOWN_RISK = {
  label: "Forecast unavailable",
  short: "N/A",
  color: "#64748b",
  badgeClass:
    "bg-slate-500/15 text-slate-600 dark:text-slate-300 ring-1 ring-slate-500/30",
  dotClass: "bg-slate-400",
  symbol: "?",
};

export function riskMeta(level: RiskLevel | null | undefined) {
  if (level === null || level === undefined || !(level in RISK_LEVELS)) {
    return UNKNOWN_RISK;
  }
  return RISK_LEVELS[level];
}
