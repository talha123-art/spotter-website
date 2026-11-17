import type {
  AnalyzeRequest,
  AnalyzeResponse,
  HeatmapResponse,
  Place,
} from "./types";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ) ?? "";

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, unknown>;
  rateLimited?: boolean;

  constructor(
    message: string,
    status: number,
    code = "error",
    fields?: Record<string, unknown>,
    rateLimited?: boolean,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.rateLimited = rateLimited;
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-json response
  }
  if (!res.ok) {
    const errObj =
      body && typeof body === "object" && "error" in body
        ? (body as { error: Record<string, unknown> }).error
        : null;
    const msg =
      (errObj && typeof errObj.message === "string" && errObj.message) ||
      `Request failed (${res.status})`;
    const code =
      (errObj && typeof errObj.code === "string" && errObj.code) || "error";
    const fields =
      errObj && typeof errObj.fields === "object"
        ? (errObj.fields as Record<string, unknown>)
        : undefined;
    const rateLimited = Boolean(errObj?.rate_limited) || res.status === 429;
    throw new ApiError(msg, res.status, code, fields, rateLimited);
  }
  return body as T;
}

export async function searchPlaces(
  q: string,
  signal?: AbortSignal,
): Promise<Place[]> {
  const url = `${API_BASE}/api/geocode?q=${encodeURIComponent(q)}&limit=5`;
  const res = await fetch(url, { signal });
  const data = await parseJson<{ results: Place[] }>(res);
  return data.results;
}

export async function analyzeTrip(
  payload: AnalyzeRequest,
  signal?: AbortSignal,
): Promise<AnalyzeResponse> {
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  return parseJson<AnalyzeResponse>(res);
}

export async function fetchHeatmap(
  payload: Omit<AnalyzeRequest, "interval">,
  signal?: AbortSignal,
): Promise<HeatmapResponse> {
  const res = await fetch(`${API_BASE}/api/heatmap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  return parseJson<HeatmapResponse>(res);
}

export async function checkHealth(
  signal?: AbortSignal,
): Promise<{ status: string; mocks: boolean }> {
  const res = await fetch(`${API_BASE}/api/health`, { signal });
  return parseJson<{ status: string; mocks: boolean }>(res);
}
