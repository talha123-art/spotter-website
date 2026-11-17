import {
  ArrowUpDown,
  CalendarClock,
  Compass,
  Minus,
  Plus,
  Scale,
} from "lucide-react";
import { useState } from "react";
import { useTripStore } from "@/lib/store";
import type { AnalyzeRequest, IntervalOption } from "@/lib/types";
import { PlaceAutocomplete } from "./PlaceAutocomplete";

const WEIGHT_PRESETS = [
  { label: "Empty", lb: 0 },
  { label: "20k", lb: 20_000 },
  { label: "40k", lb: 40_000 },
  { label: "80k", lb: 80_000 },
] as const;

const INTERVAL_OPTIONS: { value: IntervalOption; label: string }[] = [
  { value: "10", label: "10 mi" },
  { value: "25", label: "25 mi" },
  { value: "50", label: "50 mi" },
  { value: "auto", label: "Auto" },
];

interface TripFormProps {
  onSubmit: (req: AnalyzeRequest) => void;
  isLoading: boolean;
}

export function TripForm({ onSubmit, isLoading }: TripFormProps) {
  const {
    origin,
    destination,
    departureLocal,
    loadWeightLb,
    interval,
    setOrigin,
    setDestination,
    swapEndpoints,
    setDepartureLocal,
    setLoadWeightLb,
    setInterval,
  } = useTripStore();

  const [errors, setErrors] = useState<{
    origin?: string;
    destination?: string;
    departure?: string;
    load?: string;
  }>({});

  const validateAndSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: typeof errors = {};
    if (!origin) nextErrors.origin = "Select an origin from the list.";
    if (!destination)
      nextErrors.destination = "Select a destination from the list.";
    if (
      origin &&
      destination &&
      Math.abs(origin.lat - destination.lat) < 1e-4 &&
      Math.abs(origin.lng - destination.lng) < 1e-4
    ) {
      nextErrors.destination = "Destination must differ from origin.";
    }
    const depDate = new Date(departureLocal);
    if (Number.isNaN(depDate.getTime())) {
      nextErrors.departure = "Enter a valid departure date & time.";
    } else if (depDate.getTime() < Date.now() - 6 * 3600 * 1000) {
      nextErrors.departure =
        "Departure cannot be more than 6 hours in the past.";
    }
    if (
      loadWeightLb < 0 ||
      loadWeightLb > 150_000 ||
      Number.isNaN(loadWeightLb)
    ) {
      nextErrors.load = "Load weight must be between 0 and 150,000 lb.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !origin || !destination) return;

    onSubmit({
      origin: { lat: origin.lat, lng: origin.lng, label: origin.label },
      destination: {
        lat: destination.lat,
        lng: destination.lng,
        label: destination.label,
      },
      departure: depDate.toISOString(),
      load_weight_lb: loadWeightLb,
      interval,
    });
  };

  return (
    <form onSubmit={validateAndSubmit} className="space-y-3" noValidate>
      <div className="relative space-y-2.5">
        <PlaceAutocomplete
          label="Origin"
          placeholder="Search origin city or address…"
          value={origin}
          onChange={(p) => {
            setOrigin(p);
            if (p) setErrors((prev) => ({ ...prev, origin: undefined }));
          }}
          error={errors.origin}
          accentColor="emerald"
        />

        <button
          type="button"
          onClick={swapEndpoints}
          aria-label="Swap origin and destination"
          title="Swap origin and destination"
          className="absolute right-2 top-[52px] z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm transition hover:border-sky-500 hover:text-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
        </button>

        <PlaceAutocomplete
          label="Destination"
          placeholder="Search destination city or address…"
          value={destination}
          onChange={(p) => {
            setDestination(p);
            if (p) setErrors((prev) => ({ ...prev, destination: undefined }));
          }}
          error={errors.destination}
          accentColor="sky"
        />
      </div>

      {/* Departure datetime */}
      <div>
        <label
          htmlFor="departure-input"
          className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"
        >
          <CalendarClock className="h-3.5 w-3.5 text-sky-500" />
          <span>Departure (local time)</span>
        </label>
        <input
          id="departure-input"
          type="datetime-local"
          value={departureLocal}
          onChange={(e) => {
            setDepartureLocal(e.target.value);
            setErrors((prev) => ({ ...prev, departure: undefined }));
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm tabular-nums text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100"
        />
        {errors.departure && (
          <p
            role="alert"
            className="mt-1 text-xs text-red-500 dark:text-red-400"
          >
            {errors.departure}
          </p>
        )}
      </div>

      {/* Load weight */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label
            htmlFor="load-weight-input"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            <Scale className="h-3.5 w-3.5 text-sky-500" />
            <span>Load weight (lb)</span>
          </label>
          <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            {loadWeightLb > 40_000
              ? "High-load wind rules (>30k & >40k)"
              : loadWeightLb > 30_000
                ? "Wind 45+ mph → No Travel (>30k)"
                : "Standard load wind thresholds"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Decrease load weight by 2,500 lb"
            onClick={() => setLoadWeightLb(loadWeightLb - 2500)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <div className="relative flex-1">
            <input
              id="load-weight-input"
              type="number"
              min={0}
              max={150000}
              step={1000}
              value={loadWeightLb}
              onChange={(e) => setLoadWeightLb(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-9 text-sm font-medium tabular-nums text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
              lb
            </span>
          </div>
          <button
            type="button"
            aria-label="Increase load weight by 2,500 lb"
            onClick={() => setLoadWeightLb(loadWeightLb + 2500)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div
          className="mt-1.5 grid grid-cols-4 gap-1.5"
          role="group"
          aria-label="Load weight presets"
        >
          {WEIGHT_PRESETS.map((preset) => {
            const active = loadWeightLb === preset.lb;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setLoadWeightLb(preset.lb)}
                aria-pressed={active}
                className={`rounded-md py-1 text-xs font-medium tabular-nums transition ${
                  active
                    ? "bg-sky-600 text-white shadow-sm"
                    : "border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        {errors.load && (
          <p
            role="alert"
            className="mt-1 text-xs text-red-500 dark:text-red-400"
          >
            {errors.load}
          </p>
        )}
      </div>

      {/* Checkpoint interval segmented control */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
          <span>Checkpoint interval</span>
          <span className="text-[11px] text-slate-400">
            Auto: ≤200→10 · ≤800→25 · else 50 mi
          </span>
        </div>
        <div
          role="radiogroup"
          aria-label="Checkpoint sampling interval"
          className="grid grid-cols-4 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-900"
        >
          {INTERVAL_OPTIONS.map((opt) => {
            const active = interval === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setInterval(opt.value)}
                className={`rounded-md py-1 text-xs font-medium tabular-nums transition ${
                  active
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-600/20 transition hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Compass className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        <span>
          {isLoading ? "Analyzing routes & weather…" : "Analyze routes"}
        </span>
      </button>
    </form>
  );
}
