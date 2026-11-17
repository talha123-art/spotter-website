import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  const totalMin = Math.round(Math.abs(seconds) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatMiles(miles: number): string {
  if (miles >= 100) return `${Math.round(miles).toLocaleString()} mi`;
  return `${miles.toFixed(1)} mi`;
}

export function formatWeight(lb: number): string {
  return `${Math.round(lb).toLocaleString()} lb`;
}

export function formatEtaLocal(iso: string, timeZone?: string): string {
  try {
    const dt = new Date(iso);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || undefined,
      timeZoneName: "short",
    }).format(dt);
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function formatTimeShort(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || undefined,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}

/** Default departure: now + 1 hour rounded to 15 min, formatted as YYYY-MM-DDTHH:mm in local time */
export function defaultDepartureLocalInput(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalDatetimeInput(d);
}

export function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
