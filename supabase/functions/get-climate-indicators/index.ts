/**
 * get-climate-indicators Edge Function
 * 
 * STABLE VERSION - Full audit completed
 * 
 * This function:
 * 1. Accepts region_id and fetches its centroid from geometry
 * 2. Fetches annual mean temperature from Open-Meteo ERA5 archive
 * 3. Caches results in indicator_values with TTL
 * 4. Returns consistent JSON with proper HTTP status codes
 * 
 * Auth: verify_jwt=false in config.toml - we validate manually if needed
 * CORS: Full preflight support
 * Error handling: Never throws, always returns JSON with error field
 */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const DATASET_KEY_ERA5 = "copernicus_era5_land";

// Sentinel values to satisfy unique constraint (NULL != NULL in PostgreSQL)
const BASELINE_SCENARIO = "historical";
const BASELINE_PERIOD_START = 1991;
const BASELINE_PERIOD_END = 2020;

// ──────────────────────────────────────────────────────────────────────────────
// RESPONSE HELPERS
// ──────────────────────────────────────────────────────────────────────────────

interface ErrorResponse {
  error: string;
  stage: "auth" | "fetch" | "compute" | "cache" | "unknown";
  details?: unknown;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, stage: ErrorResponse["stage"], status = 500, details?: unknown): Response {
  const body: ErrorResponse = { error: message, stage };
  if (details !== undefined) body.details = details;
  return jsonResponse(body, status);
}

// ──────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

function toNumber(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : (x as number);
  return Number.isFinite(n) ? n : null;
}

function centroidFromGeom(geom: unknown): { lat: number; lon: number } | null {
  const g = geom as { type?: string; coordinates?: number[][][] | number[][][][] };
  if (!g || typeof g !== "object" || !g.coordinates) return null;

  let coords: number[][] | null = null;
  if (g.type === "Polygon") {
    coords = (g.coordinates as number[][][])?.[0] ?? null;
  } else if (g.type === "MultiPolygon") {
    coords = (g.coordinates as number[][][][])?.[0]?.[0] ?? null;
  }

  if (!coords || !coords.length) return null;

  const lons = coords.map((c) => toNumber(c?.[0])).filter((x): x is number => x !== null);
  const lats = coords.map((c) => toNumber(c?.[1])).filter((x): x is number => x !== null);
  if (!lons.length || !lats.length) return null;

  return {
    lon: lons.reduce((a, b) => a + b, 0) / lons.length,
    lat: lats.reduce((a, b) => a + b, 0) / lats.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// DATABASE ACCESS (PostgREST)
// ──────────────────────────────────────────────────────────────────────────────

type RestResult<T> = { data: T; status: number } | { error: string; status: number; body?: string };

async function restJson<T>(
  url: string,
  init: RequestInit,
  anonKey: string,
  authHeader?: string
): Promise<RestResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("apikey", anonKey);
  
  // Only set Authorization if we have a valid Bearer token
  if (authHeader && authHeader.startsWith("Bearer ") && authHeader.split(".").length === 3) {
    headers.set("Authorization", authHeader);
  }

  try {
    const res = await fetch(url, { ...init, headers });
    const text = await res.text();

    if (!res.ok) {
      return { error: `PostgREST error ${res.status}`, status: res.status, body: text };
    }

    try {
      return { data: JSON.parse(text) as T, status: res.status };
    } catch {
      return { data: undefined as unknown as T, status: res.status };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error", status: 0 };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// REGION CENTROID
// ──────────────────────────────────────────────────────────────────────────────

async function getRegionCentroid(
  regionId: string,
  supabaseUrl: string,
  anonKey: string,
  authHeader?: string
): Promise<{ lat: number; lon: number } | { error: string }> {
  const url = new URL(`${supabaseUrl}/rest/v1/regions`);
  url.searchParams.set("id", `eq.${regionId}`);
  url.searchParams.set("select", "geom");
  url.searchParams.set("limit", "1");

  const res = await restJson<Array<{ geom: unknown }>>(
    url.toString(),
    { method: "GET" },
    anonKey,
    authHeader
  );

  if ("error" in res) {
    return { error: `Region lookup failed: ${res.status} ${res.body ?? res.error}` };
  }

  const row = res.data?.[0];
  if (!row) {
    return { error: "Region not found" };
  }

  const centroid = centroidFromGeom(row.geom);
  if (!centroid) {
    return { error: "Region geometry invalid or missing" };
  }

  return centroid;
}

// ──────────────────────────────────────────────────────────────────────────────
// INDICATOR METADATA
// ──────────────────────────────────────────────────────────────────────────────

interface IndicatorMeta {
  id: string;
  code: string;
  unit: string | null;
  ttlDays: number;
}

// Fallback indicator definition when not in database
const FALLBACK_INDICATOR: IndicatorMeta = {
  id: "temp_mean_annual_fallback",
  code: "temp_mean_annual",
  unit: "°C",
  ttlDays: 90,
};

async function getIndicatorMeta(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string | undefined,
  code: string
): Promise<IndicatorMeta> {
  const url = new URL(`${supabaseUrl}/rest/v1/indicators`);
  url.searchParams.set("select", "id,code,unit,default_ttl_days");
  url.searchParams.set("code", `eq.${code}`);

  try {
    const res = await restJson<Array<{ id: string; code: string; unit: string | null; default_ttl_days: number | null }>>(
      url.toString(),
      { method: "GET" },
      anonKey,
      authHeader
    );

    if ("error" in res) {
      console.warn(`[get-climate-indicators] Indicator lookup failed, using fallback: ${res.status}`);
      return FALLBACK_INDICATOR;
    }

    const row = res.data?.[0];
    if (!row) {
      console.warn(`[get-climate-indicators] Indicator '${code}' not in database, using fallback`);
      return FALLBACK_INDICATOR;
    }

    return { id: row.id, code: row.code, unit: row.unit, ttlDays: row.default_ttl_days ?? 90 };
  } catch (e) {
    console.warn(`[get-climate-indicators] Indicator lookup error, using fallback:`, e);
    return FALLBACK_INDICATOR;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CACHE CHECK
// ──────────────────────────────────────────────────────────────────────────────

async function checkCache(args: {
  supabaseUrl: string;
  anonKey: string;
  authHeader?: string;
  regionId: string;
  indicatorId: string;
  year: number;
}): Promise<{ value: number } | null> {
  const nowIso = new Date().toISOString();

  const cacheUrl = new URL(`${args.supabaseUrl}/rest/v1/indicator_values`);
  cacheUrl.searchParams.set("select", "value");
  cacheUrl.searchParams.set("region_id", `eq.${args.regionId}`);
  cacheUrl.searchParams.set("indicator_id", `eq.${args.indicatorId}`);
  cacheUrl.searchParams.set("year", `eq.${args.year}`);
  cacheUrl.searchParams.set("scenario", `eq.${BASELINE_SCENARIO}`);
  cacheUrl.searchParams.set("period_start", `eq.${BASELINE_PERIOD_START}`);
  cacheUrl.searchParams.set("period_end", `eq.${BASELINE_PERIOD_END}`);
  cacheUrl.searchParams.set("expires_at", `gt.${nowIso}`);
  cacheUrl.searchParams.set("limit", "1");

  const res = await restJson<Array<{ value: number }>>(
    cacheUrl.toString(),
    { method: "GET" },
    args.anonKey,
    args.authHeader
  );

  if ("error" in res) return null;

  const row = res.data?.[0];
  return row && typeof row.value === "number" ? { value: row.value } : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// CACHE UPSERT (BEST EFFORT)
// ──────────────────────────────────────────────────────────────────────────────

async function upsertCache(args: {
  supabaseUrl: string;
  anonKey: string;
  authHeader?: string;
  regionId: string;
  indicatorId: string;
  year: number;
  value: number;
  ttlDays: number;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + args.ttlDays * 86400000).toISOString();

  const payload = {
    region_id: args.regionId,
    indicator_id: args.indicatorId,
    year: args.year,
    value: args.value,
    scenario: BASELINE_SCENARIO,
    period_start: BASELINE_PERIOD_START,
    period_end: BASELINE_PERIOD_END,
    computed_at: nowIso,
    expires_at: expiresAt,
    stale: false,
  };

  const upsertUrl = new URL(`${args.supabaseUrl}/rest/v1/indicator_values`);
  upsertUrl.searchParams.set(
    "on_conflict",
    "indicator_id,region_id,year,scenario,period_start,period_end"
  );

  try {
    const res = await fetch(upsertUrl.toString(), {
      method: "POST",
      headers: {
        apikey: args.anonKey,
        ...(args.authHeader ? { Authorization: args.authHeader } : {}),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn("[get-climate-indicators] cache upsert failed (non-fatal):", res.status);
    }
  } catch (e) {
    console.warn("[get-climate-indicators] cache upsert error (non-fatal):", e);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// OPEN-METEO API
// ──────────────────────────────────────────────────────────────────────────────

interface TempResult {
  value: number;
  dailyCount: number;
}

async function fetchAnnualMeanTempC(
  lat: number,
  lon: number,
  year: number
): Promise<TempResult | { error: string }> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    daily: "temperature_2m_mean",
    timezone: "UTC",
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(`${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      return { error: `Open-Meteo failed: ${res.status} ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    const arr = data?.daily?.temperature_2m_mean ?? [];
    const vals = arr.map(toNumber).filter((v: number | null): v is number => v !== null);

    if (!vals.length) {
      return { error: "No temperature data available for this location/year" };
    }

    const mean = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
    return { value: Math.round(mean * 10) / 10, dailyCount: vals.length };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { error: "Open-Meteo request timed out after 12s" };
    }
    return { error: e instanceof Error ? e.message : "Network error fetching climate data" };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ──────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight - always respond
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", "auth", 405);
  }

  // Environment check
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    return errorResponse("Server configuration error: missing environment variables", "unknown", 500);
  }

  // Auth header (optional - we work with or without valid JWT)
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? undefined;
  
  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", "auth", 400);
  }

  // Extract parameters
  const regionId = (body.p_region_id ?? body.region_id) as string | undefined;
  if (!regionId || typeof regionId !== "string") {
    return errorResponse("Missing required parameter: p_region_id (uuid string)", "auth", 400);
  }

  const year = typeof body.year === "number" ? body.year : new Date().getUTCFullYear() - 1;

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN LOGIC
  // ─────────────────────────────────────────────────────────────────────────────

  // 1. Get indicator metadata (uses fallback if not in database)
  const indicator = await getIndicatorMeta(supabaseUrl, anonKey, authHeader, "temp_mean_annual");

  // 2. Check cache first (only if we have a real indicator ID)
  if (!indicator.id.includes("fallback")) {
    const cached = await checkCache({
      supabaseUrl,
      anonKey,
      authHeader,
      regionId,
      indicatorId: indicator.id,
      year,
    });

    if (cached) {
      return jsonResponse({
        indicators: [
          {
            indicator_code: "temp_mean_annual",
            value: cached.value,
            unit: indicator.unit || "°C",
            scenario: BASELINE_SCENARIO,
            period_start: BASELINE_PERIOD_START,
            period_end: BASELINE_PERIOD_END,
            is_baseline: true,
            dataset_key: DATASET_KEY_ERA5,
          },
        ],
        datasets_used: [DATASET_KEY_ERA5],
        cached: true,
        computed_at: new Date().toISOString(),
      });
    }
  }

  // 3. Get region centroid
  const centroidResult = await getRegionCentroid(regionId, supabaseUrl, anonKey, authHeader);
  if ("error" in centroidResult) {
    return errorResponse(centroidResult.error, "fetch", 500);
  }
  const { lat, lon } = centroidResult;

  // 4. Fetch temperature from Open-Meteo
  const tempResult = await fetchAnnualMeanTempC(lat, lon, year);
  if ("error" in tempResult) {
    return errorResponse(tempResult.error, "compute", 500);
  }

  // 5. Cache the result (best-effort, only if we have a real indicator ID)
  if (!indicator.id.includes("fallback")) {
    await upsertCache({
      supabaseUrl,
      anonKey,
      authHeader,
      regionId,
      indicatorId: indicator.id,
      year,
      value: tempResult.value,
      ttlDays: indicator.ttlDays,
    });
  }

  // 6. Return success response
  return jsonResponse({
    indicators: [
      {
        indicator_code: "temp_mean_annual",
        value: tempResult.value,
        unit: indicator.unit || "°C",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
    ],
    datasets_used: [DATASET_KEY_ERA5],
    cached: false,
    computed_at: new Date().toISOString(),
  });
});
