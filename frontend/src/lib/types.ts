export type RiskLevel = 0 | 1 | 2 | 3 | 4;
export type IntervalOption = "10" | "25" | "50" | "auto";

export interface Place {
  label: string;
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

export interface WeatherSample {
  wind_mph: number;
  gust_mph: number;
  rain_in: number;
  snow_in: number;
  precip_in: number;
}

export interface Checkpoint {
  index: number;
  distance_mi: number;
  lat: number;
  lng: number;
  eta: string;
  elapsed_s: number;
  timezone: string;
  forecast_available: boolean;
  weather: WeatherSample | null;
  levels: { wind: RiskLevel; rain: RiskLevel; snow: RiskLevel } | null;
  base_level: RiskLevel | null;
  level: RiskLevel | null;
  level_label: string;
  dominant: "wind" | "rain" | "snow" | "wind+load" | "none" | null;
  load_override: boolean;
  reason: string;
}

export interface RouteSegment {
  level: RiskLevel | null;
  coords: [number, number][];
}

export interface RouteMetrics {
  miles_by_level: [number, number, number, number, number];
  unknown_miles: number;
  avg_risk: number;
  worst_level: RiskLevel | null;
  no_travel_checkpoints: number;
  unavailable_checkpoints: number;
  distance_mi: number;
  duration_s: number;
}

export interface AnalyzedRoute {
  id: string;
  label: string;
  provider: string;
  synthetic: boolean;
  distance_mi: number;
  duration_s: number;
  departure: string;
  arrival: string;
  geometry: [number, number][];
  segments: RouteSegment[];
  checkpoints: Checkpoint[];
  metrics: RouteMetrics;
  summary: string;
  rank: number;
  recommended: boolean;
}

export interface Recommendation {
  route_id: string;
  ranking: string[];
  explanation: string;
  tradeoff: string;
  all_have_no_travel: boolean;
  decisive_factor: string | null;
}

export interface AnalyzeResponse {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  departure: string;
  load_weight_lb: number;
  interval_mode: IntervalOption;
  interval_mi: number;
  providers: { routing: string; weather: string };
  warnings: string[];
  routes: AnalyzedRoute[];
  recommendation: Recommendation;
  generated_at: string;
}

/** [lat, lng, [49 hourly risk ints (-1 = unavailable)]] */
export type HeatmapPoint = [number, number, number[]];

export interface HeatmapResponse {
  base_time: string;
  hours: number;
  load_weight_lb: number;
  provider: string;
  warnings: string[];
  points: HeatmapPoint[];
}

export interface AnalyzeRequest {
  origin: { lat: number; lng: number; label?: string };
  destination: { lat: number; lng: number; label?: string };
  departure: string;
  load_weight_lb: number;
  interval: IntervalOption;
}
