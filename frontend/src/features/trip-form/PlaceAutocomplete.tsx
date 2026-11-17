import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchPlaces } from "@/lib/api";
import type { Place } from "@/lib/types";

const QUICK_PLACES: Place[] = [
  {
    label: "Chicago, Illinois, United States",
    name: "Chicago",
    detail: "Illinois, United States",
    lat: 41.8781,
    lng: -87.6298,
  },
  {
    label: "Denver, Colorado, United States",
    name: "Denver",
    detail: "Colorado, United States",
    lat: 39.7392,
    lng: -104.9903,
  },
  {
    label: "Kansas City, Missouri, United States",
    name: "Kansas City",
    detail: "Missouri, United States",
    lat: 39.0997,
    lng: -94.5786,
  },
  {
    label: "Dallas, Texas, United States",
    name: "Dallas",
    detail: "Texas, United States",
    lat: 32.7767,
    lng: -96.797,
  },
  {
    label: "Salt Lake City, Utah, United States",
    name: "Salt Lake City",
    detail: "Utah, United States",
    lat: 40.7608,
    lng: -111.891,
  },
];

interface PlaceAutocompleteProps {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  error?: string;
  accentColor?: "emerald" | "sky";
}

export function PlaceAutocomplete({
  label,
  placeholder,
  value,
  onChange,
  error,
  accentColor = "sky",
}: PlaceAutocompleteProps) {
  const inputId = useId();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setQuery(value?.label ?? "");
  }, [value]);

  const debounced = useDebouncedValue(query.trim(), 300);
  const shouldFetch =
    open && debounced.length >= 2 && debounced !== value?.label;

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["geocode", debounced],
    queryFn: ({ signal }) => searchPlaces(debounced, signal),
    enabled: shouldFetch,
    staleTime: 1000 * 60 * 15,
  });

  const items = debounced.length >= 2 ? results : QUICK_PLACES;

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length, debounced]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selectPlace = (p: Place) => {
    onChange(p);
    setQuery(p.label);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        items.length ? (i - 1 + items.length) % items.length : 0,
      );
    } else if (e.key === "Enter" && open && items[activeIndex]) {
      e.preventDefault();
      selectPlace(items[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const dotClass =
    accentColor === "emerald"
      ? "bg-emerald-500 ring-emerald-500/30"
      : "bg-sky-500 ring-sky-500/30";

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={inputId}
        className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-3 h-2.5 w-2.5 rounded-full ring-4 ${dotClass}`}
        />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && items[activeIndex]
              ? `${listboxId}-${activeIndex}`
              : undefined
          }
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (value) onChange(null);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        {isFetching ? (
          <Loader2
            aria-label="Searching places"
            className=" absolute right-2.5 h-4 w-4 animate-spin text-slate-400"
          />
        ) : query ? (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => {
              setQuery("");
              onChange(null);
              setOpen(true);
            }}
            className="absolute right-2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {error && (
        <p role="alert" className="mt-1 text-xs text-red-500 dark:text-red-400">
          {error}
        </p>
      )}

      {open && items.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute z-40 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {debounced.length < 2 && (
            <li className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Major Freight Hubs
            </li>
          )}
          {items.map((item, idx) => {
            const active = idx === activeIndex;
            return (
              <li
                key={`${item.lat}-${item.lng}-${idx}`}
                id={`${listboxId}-${idx}`}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectPlace(item);
                }}
                className={`flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                  active
                    ? "bg-sky-500/15 text-sky-900 dark:text-sky-100"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                }`}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.name}</div>
                  {item.detail && (
                    <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {item.detail}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
