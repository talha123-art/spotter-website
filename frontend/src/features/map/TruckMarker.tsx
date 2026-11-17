import { formatTimeShort } from "@/lib/format";
import { RISK_LEVELS, UNKNOWN_RISK } from "@/lib/risk";
import type { RiskLevel } from "@/lib/types";
import { shortestAngleDelta, type TruckSample } from "./truckKinematics";

/**
 * Computes a subtle trailer fill color reflecting trailer load weight:
 * Empty (0 lb) -> bright silver-white (#f8fafc)
 * Heavy (80k+ lb) -> deeper slate-blue (#94a3b8)
 */
export function trailerColorForLoad(loadWeightLb: number): string {
  const ratio = Math.max(0, Math.min(1, loadWeightLb / 80_000));
  if (ratio < 0.15) return "#f8fafc";
  if (ratio < 0.45) return "#e2e8f0";
  if (ratio < 0.75) return "#cbd5e1";
  return "#94a3b8";
}

function buildTruckSvgMarkup(trailerFill: string, loadRatio: number): string {
  const cargoBars = Math.round(loadRatio * 4);
  const barsSvg = Array.from({ length: cargoBars }, (_, i) => {
    const y = 17 + i * 4;
    return `<rect x="17" y="${y}" width="8" height="2.4" rx="0.8" fill="#0284c7" opacity="0.75" />`;
  }).join("");

  // Top-down semi-truck (tractor cab pointing North at 0 deg + articulated trailer)
  return `
    <svg viewBox="0 0 42 42" width="40" height="40" class="w-8 h-8 md:w-10 md:h-10 drop-shadow-[0_3px_6px_rgba(0,0,0,0.65)]" aria-hidden="true">
      <!-- Side mirrors -->
      <path d="M12 10 L15 11 M30 10 L27 11" stroke="#0f172a" stroke-width="1.6" stroke-linecap="round" />
      <!-- Tractor cab (front pointing up / North) -->
      <path d="M16 5 C16 3.5 26 3.5 26 5 L27 13 L15 13 Z" fill="#ffffff" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="round" />
      <!-- Windshield -->
      <path d="M16.8 7.2 L25.2 7.2 L25.8 10.2 L16.2 10.2 Z" fill="#0284c7" />
      <!-- Fifth-wheel coupling -->
      <rect x="19" y="12.5" width="4" height="3" fill="#334155" />
      <!-- Semi-trailer body -->
      <rect x="14.5" y="14.5" width="13" height="22" rx="2" fill="${trailerFill}" stroke="#0f172a" stroke-width="1.8" />
      <!-- Load fill indicator bars -->
      ${barsSvg}
      <!-- Rear bumper / tail lights -->
      <rect x="15.5" y="35.2" width="3.2" height="1.4" rx="0.5" fill="#ef4444" />
      <rect x="23.3" y="35.2" width="3.2" height="1.4" rx="0.5" fill="#ef4444" />
    </svg>
  `;
}

export interface PrimaryTruckDom {
  root: HTMLDivElement;
  ringEl: HTMLDivElement;
  rotatorEl: HTMLDivElement;
  svgContainerEl: HTMLDivElement;
  hudTimeEl: HTMLSpanElement;
  hudBadgeEl: HTMLSpanElement;
  hudMilesEl: HTMLDivElement;
  hudWxEl: HTMLDivElement;
  currentAngle: number | null;
  lastHudUpdateMs: number;
}

export function createPrimaryTruckDom(
  loadWeightLb: number,
  onClick: () => void,
): PrimaryTruckDom {
  const root = document.createElement("div");
  root.className =
    "truck-marker-primary relative flex items-center justify-center select-none";
  root.style.zIndex = "15";

  // Floating HUD card above the truck (does NOT rotate with the truck)
  const hud = document.createElement("div");
  hud.setAttribute("data-testid", "truck-hud");
  hud.className =
    "hidden md:flex flex-col gap-0.5 pointer-events-auto cursor-pointer absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 w-56 rounded-xl border border-slate-300/90 dark:border-slate-700/95 bg-white/95 dark:bg-slate-900/95 px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 shadow-xl backdrop-blur-md";

  const topRow = document.createElement("div");
  topRow.className = "flex items-center justify-between gap-1.5";
  const hudTimeEl = document.createElement("span");
  hudTimeEl.setAttribute("data-testid", "truck-hud-time");
  hudTimeEl.className =
    "font-semibold tabular-nums truncate text-slate-900 dark:text-white";
  const hudBadgeEl = document.createElement("span");
  hudBadgeEl.setAttribute("data-testid", "truck-hud-risk");
  hudBadgeEl.className =
    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-tight tabular-nums";
  topRow.append(hudTimeEl, hudBadgeEl);

  const hudMilesEl = document.createElement("div");
  hudMilesEl.setAttribute("data-testid", "truck-hud-miles");
  hudMilesEl.className =
    "font-medium tabular-nums text-sky-700 dark:text-sky-300";

  const hudWxEl = document.createElement("div");
  hudWxEl.setAttribute("data-testid", "truck-hud-wx");
  hudWxEl.className =
    "tabular-nums text-[10px] text-slate-500 dark:text-slate-400 truncate";

  hud.append(topRow, hudMilesEl, hudWxEl);
  hud.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });

  // Clickable truck button + risk status ring
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute(
    "aria-label",
    "Inspect truck current position and weather risk",
  );
  btn.setAttribute("data-testid", "truck-marker-button");
  btn.className =
    "relative flex items-center justify-center rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-sky-400 cursor-pointer";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });

  const ringEl = document.createElement("div");
  ringEl.setAttribute("data-testid", "truck-status-ring");
  ringEl.className =
    "absolute inset-0 rounded-full border-[3px] transition-colors duration-150";

  const rotatorEl = document.createElement("div");
  rotatorEl.setAttribute("data-testid", "truck-rotator");
  rotatorEl.className =
    "relative z-10 flex items-center justify-center will-change-transform";

  const svgContainerEl = document.createElement("div");
  const ratio = Math.max(0, Math.min(1, loadWeightLb / 80_000));
  svgContainerEl.innerHTML = buildTruckSvgMarkup(
    trailerColorForLoad(loadWeightLb),
    ratio,
  );
  rotatorEl.appendChild(svgContainerEl);

  btn.append(ringEl, rotatorEl);
  root.append(hud, btn);

  return {
    root,
    ringEl,
    rotatorEl,
    svgContainerEl,
    hudTimeEl,
    hudBadgeEl,
    hudMilesEl,
    hudWxEl,
    currentAngle: null,
    lastHudUpdateMs: 0,
  };
}

export function updatePrimaryTruckLoadStyle(
  dom: PrimaryTruckDom,
  loadWeightLb: number,
): void {
  const ratio = Math.max(0, Math.min(1, loadWeightLb / 80_000));
  dom.svgContainerEl.innerHTML = buildTruckSvgMarkup(
    trailerColorForLoad(loadWeightLb),
    ratio,
  );
}

export function updatePrimaryTruckDom(
  dom: PrimaryTruckDom,
  sample: TruckSample,
  departureMs: number,
  forceHudUpdate = false,
): void {
  // 1. Shortest-angle rotation update (every frame)
  if (dom.currentAngle === null) {
    dom.currentAngle = sample.bearing;
  } else {
    dom.currentAngle =
      dom.currentAngle + shortestAngleDelta(dom.currentAngle, sample.bearing);
  }
  dom.rotatorEl.style.transform = `rotate(${dom.currentAngle.toFixed(1)}deg)`;

  // 2. Status ring / halo color & subtle No Travel pulse
  const lvl = sample.riskLevel;
  const meta = lvl !== null && lvl in RISK_LEVELS ? RISK_LEVELS[lvl] : null;
  const ringColor = meta ? meta.color : UNKNOWN_RISK.color;
  dom.ringEl.style.borderColor = ringColor;
  dom.ringEl.style.backgroundColor = `${ringColor}28`;
  dom.ringEl.style.boxShadow = `0 0 12px ${ringColor}99`;
  dom.ringEl.setAttribute(
    "data-risk-level",
    lvl === null ? "unknown" : String(lvl),
  );

  if (lvl === 4) {
    dom.ringEl.classList.add("truck-ring-pulse");
  } else {
    dom.ringEl.classList.remove("truck-ring-pulse");
  }

  // 3. Throttled HUD text update (~5 Hz = 200ms, or immediately on scrub/stop/force)
  const now = performance.now();
  if (!forceHudUpdate && now - dom.lastHudUpdateMs < 180) {
    return;
  }
  dom.lastHudUpdateMs = now;

  const currentIso = new Date(
    departureMs + sample.elapsedSec * 1000,
  ).toISOString();
  const tz = sample.nearestCheckpoint?.timezone;
  dom.hudTimeEl.textContent = formatTimeShort(currentIso, tz);

  if (!sample.forecastAvailable || meta === null) {
    dom.hudBadgeEl.textContent = "Forecast unavailable";
    dom.hudBadgeEl.style.backgroundColor = "#334155";
    dom.hudBadgeEl.style.color = "#e2e8f0";
  } else {
    dom.hudBadgeEl.textContent = `${meta.symbol} ${meta.label}`;
    dom.hudBadgeEl.style.backgroundColor = meta.color;
    dom.hudBadgeEl.style.color = lvl === 1 ? "#0f172a" : "#ffffff";
  }

  if (sample.status === "arrived") {
    dom.hudMilesEl.textContent = `Arrived · ${Math.round(sample.totalDistanceMi).toLocaleString()} mi total`;
  } else if (sample.status === "origin") {
    dom.hudMilesEl.textContent = `At Origin · 0 / ${Math.round(sample.totalDistanceMi).toLocaleString()} mi`;
  } else {
    dom.hudMilesEl.textContent = `${Math.round(sample.distanceMi).toLocaleString()} mi · ${Math.round(sample.remainingMi).toLocaleString()} mi left`;
  }

  const wx = sample.nearestCheckpoint?.weather;
  if (!sample.forecastAvailable || !wx) {
    dom.hudWxEl.textContent = "Forecast unavailable at this hour";
  } else {
    dom.hudWxEl.textContent = `Wind ${wx.wind_mph.toFixed(0)} mph · Rain ${wx.rain_in.toFixed(2)}" · Snow ${wx.snow_in.toFixed(2)}"`;
  }
}

export interface GhostTruckDom {
  root: HTMLDivElement;
  rotatorEl: HTMLDivElement;
  ringEl: HTMLDivElement;
  currentAngle: number | null;
}

export function createGhostTruckDom(
  routeLabel: string,
  onClick: () => void,
): GhostTruckDom {
  const root = document.createElement("div");
  root.setAttribute("data-testid", "ghost-truck-marker");
  root.title = `${routeLabel} comparison truck (click to select route)`;
  root.className =
    "truck-marker-ghost relative flex items-center justify-center cursor-pointer";
  root.style.zIndex = "10";
  root.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });

  const inner = document.createElement("div");
  inner.className =
    "relative flex items-center justify-center rounded-full p-0.5";
  inner.style.opacity = "0.32";

  const ringEl = document.createElement("div");
  ringEl.className = "absolute inset-0 rounded-full border-2";

  const rotatorEl = document.createElement("div");
  rotatorEl.className =
    "relative z-10 flex items-center justify-center will-change-transform";
  rotatorEl.innerHTML = buildTruckSvgMarkup("#e2e8f0", 0.3);

  inner.append(ringEl, rotatorEl);
  root.appendChild(inner);
  return { root, rotatorEl, ringEl, currentAngle: null };
}

export function updateGhostTruckDom(
  dom: GhostTruckDom,
  sample: TruckSample,
): void {
  if (dom.currentAngle === null) {
    dom.currentAngle = sample.bearing;
  } else {
    dom.currentAngle =
      dom.currentAngle + shortestAngleDelta(dom.currentAngle, sample.bearing);
  }
  dom.rotatorEl.style.transform = `rotate(${dom.currentAngle.toFixed(1)}deg) scale(0.85)`;
  const lvl = sample.riskLevel as RiskLevel | null;
  const color =
    lvl !== null && lvl in RISK_LEVELS
      ? RISK_LEVELS[lvl].color
      : UNKNOWN_RISK.color;
  dom.ringEl.style.borderColor = color;
}
