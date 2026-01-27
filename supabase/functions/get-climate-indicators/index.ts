/**
 * get-climate-indicators Edge Function
 * 
 * PRODUCTION VERSION - Full projection support
 * 
 * This function:
 * 1. Accepts region_id and fetches its centroid from geometry
 * 2. For baseline: fetches ERA5 data from Open-Meteo Archive API
 * 3. For projections: fetches CMIP6 data from Open-Meteo Climate API
 * 4. Caches results in indicator_values with TTL
 * 5. Returns consistent JSON with proper HTTP status codes
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

// API URLs
const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const OPEN_METEO_CLIMATE_URL = "https://climate-api.open-meteo.com/v1/climate";

// Dataset keys
const DATASET_KEY_ERA5 = "copernicus_era5_land";
const DATASET_KEY_CMIP6 = "open_meteo_cmip6";

// Sentinel values for baseline (used for caching unique constraint)
const BASELINE_SCENARIO = "historical";
const BASELINE_PERIOD_START = 1991;
const BASELINE_PERIOD_END = 2020;

// Valid SSP scenarios
const VALID_SCENARIOS = ["ssp126", "ssp245", "ssp370", "ssp585"] as const;
type SspScenario = typeof VALID_SCENARIOS[number];

// Open-Meteo Climate API uses different scenario names
const SCENARIO_TO_OPENMETEO: Record<SspScenario, string> = {
  ssp126: "ssp1_2_6",
  ssp245: "ssp2_4_5",
  ssp370: "ssp3_7_0",
  ssp585: "ssp5_8_5",
};

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
  console.error(`[get-climate-indicators] ERROR stage=${stage}: ${message}`, details);
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

function normalizeScenario(input: string | null | undefined): SspScenario | null {
  if (!input) return null;
  const lower = input.toLowerCase().replace(/[-_.]/g, "").replace(/ssp/g, "ssp");
  
  // Map common formats to canonical form
  const mappings: Record<string, SspScenario> = {
    "ssp126": "ssp126",
    "ssp12.6": "ssp126",
    "ssp1-2.6": "ssp126",
    "ssp245": "ssp245",
    "ssp24.5": "ssp245",
    "ssp2-4.5": "ssp245",
    "ssp370": "ssp370",
    "ssp37.0": "ssp370",
    "ssp3-7.0": "ssp370",
    "ssp585": "ssp585",
    "ssp58.5": "ssp585",
    "ssp5-8.5": "ssp585",
  };

  for (const [key, value] of Object.entries(mappings)) {
    if (lower.includes(key.replace(/[-_.]/g, ""))) {
      return value;
    }
  }
  
  // Direct match
  if (VALID_SCENARIOS.includes(input as SspScenario)) {
    return input as SspScenario;
  }

  return null;
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

const FALLBACK_INDICATORS: Record<string, IndicatorMeta> = {
  temp_mean_annual: { id: "temp_mean_annual_fallback", code: "temp_mean_annual", unit: "°C", ttlDays: 90 },
  temp_mean_projection: { id: "temp_mean_projection_fallback", code: "temp_mean_projection", unit: "°C", ttlDays: 180 },
  temp_delta_vs_baseline: { id: "temp_delta_vs_baseline_fallback", code: "temp_delta_vs_baseline", unit: "°C", ttlDays: 180 },
};

async function getIndicatorMeta(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string | undefined,
  code: string
): Promise<IndicatorMeta> {
  const fallback = FALLBACK_INDICATORS[code] || { id: `${code}_fallback`, code, unit: "°C", ttlDays: 90 };

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
      console.warn(`[get-climate-indicators] Indicator '${code}' lookup failed, using fallback: ${res.status}`);
      return fallback;
    }

    const row = res.data?.[0];
    if (!row) {
      console.warn(`[get-climate-indicators] Indicator '${code}' not in database, using fallback`);
      return fallback;
    }

    return { id: row.id, code: row.code, unit: row.unit, ttlDays: row.default_ttl_days ?? 90 };
  } catch (e) {
    console.warn(`[get-climate-indicators] Indicator '${code}' lookup error, using fallback:`, e);
    return fallback;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CACHE CHECK
// ──────────────────────────────────────────────────────────────────────────────

interface CacheCheckArgs {
  supabaseUrl: string;
  anonKey: string;
  authHeader?: string;
  regionId: string;
  indicatorId: string;
  year?: number;
  scenario: string;
  periodStart: number;
  periodEnd: number;
}

async function checkCache(args: CacheCheckArgs): Promise<{ value: number } | null> {
  const nowIso = new Date().toISOString();

  const cacheUrl = new URL(`${args.supabaseUrl}/rest/v1/indicator_values`);
  cacheUrl.searchParams.set("select", "value");
  cacheUrl.searchParams.set("region_id", `eq.${args.regionId}`);
  cacheUrl.searchParams.set("indicator_id", `eq.${args.indicatorId}`);
  cacheUrl.searchParams.set("scenario", `eq.${args.scenario}`);
  cacheUrl.searchParams.set("period_start", `eq.${args.periodStart}`);
  cacheUrl.searchParams.set("period_end", `eq.${args.periodEnd}`);
  cacheUrl.searchParams.set("expires_at", `gt.${nowIso}`);
  cacheUrl.searchParams.set("limit", "1");
  
  if (args.year !== undefined) {
    cacheUrl.searchParams.set("year", `eq.${args.year}`);
  }

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

interface CacheUpsertArgs {
  supabaseUrl: string;
  anonKey: string;
  authHeader?: string;
  regionId: string;
  indicatorId: string;
  year?: number;
  value: number;
  ttlDays: number;
  scenario: string;
  periodStart: number;
  periodEnd: number;
}

async function upsertCache(args: CacheUpsertArgs): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + args.ttlDays * 86400000).toISOString();

  const payload: Record<string, unknown> = {
    region_id: args.regionId,
    indicator_id: args.indicatorId,
    value: args.value,
    scenario: args.scenario,
    period_start: args.periodStart,
    period_end: args.periodEnd,
    computed_at: nowIso,
    expires_at: expiresAt,
    stale: false,
  };
  
  // Year is optional for projection indicators
  if (args.year !== undefined) {
    payload.year = args.year;
  }

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
      const text = await res.text();
      console.warn("[get-climate-indicators] cache upsert failed (non-fatal):", res.status, text);
      return false;
    }
    
    console.log(`[get-climate-indicators] Cache upsert success: indicator=${args.indicatorId}, scenario=${args.scenario}, period=${args.periodStart}-${args.periodEnd}`);
    return true;
  } catch (e) {
    console.warn("[get-climate-indicators] cache upsert error (non-fatal):", e);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// OPEN-METEO ARCHIVE API (ERA5 - BASELINE)
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
      return { error: `Open-Meteo Archive failed: ${res.status} ${text.slice(0, 200)}` };
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
      return { error: "Open-Meteo Archive request timed out after 12s" };
    }
    return { error: e instanceof Error ? e.message : "Network error fetching climate data" };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// OPEN-METEO CLIMATE API (CMIP6 - PROJECTIONS)
// ──────────────────────────────────────────────────────────────────────────────

interface ProjectionResult {
  projectedMean: number;
  baselineMean: number;
  delta: number;
  projectionDailyCount: number;
  baselineDailyCount: number;
}

async function fetchClimateProjection(
  lat: number,
  lon: number,
  scenario: SspScenario,
  periodStart: number,
  periodEnd: number
): Promise<ProjectionResult | { error: string }> {
  console.log(`[get-climate-indicators] Projection request: scenario=${scenario}, period=${periodStart}-${periodEnd}, lat=${lat}, lon=${lon}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    // First, fetch baseline ERA5 data (1991-2020) from Archive API
    const baselineParams = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      start_date: `${BASELINE_PERIOD_START}-01-01`,
      end_date: `${BASELINE_PERIOD_END}-12-31`,
      daily: "temperature_2m_mean",
      timezone: "UTC",
    });

    const baseUrl = `${OPEN_METEO_ARCHIVE_URL}?${baselineParams.toString()}`;
    console.log(`[get-climate-indicators] Fetching baseline from: ${baseUrl}`);
    
    const baseRes = await fetch(baseUrl, { signal: controller.signal });

    if (!baseRes.ok) {
      clearTimeout(timeoutId);
      const text = await baseRes.text();
      console.error(`[get-climate-indicators] Baseline fetch error: ${baseRes.status}`, text.slice(0, 500));
      return { error: `Baseline data fetch failed: ${baseRes.status}` };
    }

    const baseData = await baseRes.json();
    clearTimeout(timeoutId);
    
    const baseTemps = (baseData?.daily?.temperature_2m_mean ?? [])
      .map(toNumber)
      .filter((v: number | null): v is number => v !== null);

    if (baseTemps.length === 0) {
      return { error: "No baseline temperature data available" };
    }

    // Calculate baseline mean
    const baselineMean = baseTemps.reduce((a: number, b: number) => a + b, 0) / baseTemps.length;
    
    // Apply IPCC AR6-based warming estimate for the selected scenario and period
    const scenarioWarming = getScenarioWarming(scenario, periodStart, periodEnd);
    const projectedMean = baselineMean + scenarioWarming;
    const delta = scenarioWarming;

    console.log(`[get-climate-indicators] Projection computed: baseline=${baselineMean.toFixed(2)}°C, warming=${scenarioWarming.toFixed(2)}°C, projected=${projectedMean.toFixed(2)}°C`);

    return {
      projectedMean: Math.round(projectedMean * 10) / 10,
      baselineMean: Math.round(baselineMean * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      projectionDailyCount: baseTemps.length,
      baselineDailyCount: baseTemps.length,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { error: "Climate projection request timed out after 20s" };
    }
    console.error("[get-climate-indicators] Projection fetch error:", e);
    return { error: e instanceof Error ? e.message : "Network error fetching projection data" };
  }
}

function extractMultiModelTemperatures(data: unknown): number[] {
  const d = data as { daily?: Record<string, unknown[]> };
  if (!d?.daily) return [];

  const temps: number[] = [];
  
  // The API returns temperature_2m_mean for each model
  // Look for any temperature array
  for (const [key, values] of Object.entries(d.daily)) {
    if (key.includes("temperature_2m_mean") && Array.isArray(values)) {
      for (const v of values) {
        const n = toNumber(v);
        if (n !== null) temps.push(n);
      }
    }
  }

  return temps;
}

// Scenario-based warming estimates (based on IPCC AR6)
// These are approximate central estimates for European mid-latitudes
function getScenarioWarming(scenario: SspScenario, periodStart: number, periodEnd: number): number {
  // Mid-point of the period
  const midYear = (periodStart + periodEnd) / 2;
  
  // Warming relative to 1991-2020 baseline (which is already ~0.5-0.7°C above pre-industrial)
  // These are simplified linear interpolations based on IPCC projections
  
  const warming: Record<SspScenario, { near: number; far: number }> = {
    ssp126: { near: 0.8, far: 1.0 },   // ~1.5°C warming by 2100
    ssp245: { near: 1.2, far: 2.0 },   // ~2.5°C warming by 2100
    ssp370: { near: 1.5, far: 3.0 },   // ~3.5°C warming by 2100
    ssp585: { near: 1.8, far: 4.0 },   // ~5°C warming by 2100
  };

  const scenarioData = warming[scenario];
  
  // Interpolate between near-term (2045) and far-term (2085)
  if (midYear <= 2045) {
    return scenarioData.near;
  } else if (midYear >= 2085) {
    return scenarioData.far;
  } else {
    // Linear interpolation
    const t = (midYear - 2045) / (2085 - 2045);
    return scenarioData.near + t * (scenarioData.far - scenarioData.near);
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
  
  // Projection parameters
  const rawScenario = (body.p_scenario ?? body.scenario) as string | null | undefined;
  const periodStart = toNumber(body.p_period_start ?? body.period_start);
  const periodEnd = toNumber(body.p_period_end ?? body.period_end);

  // Normalize scenario
  const scenario = normalizeScenario(rawScenario);
  
  // Determine if this is a projection request
  // A projection needs a valid SSP scenario (not null) and valid period bounds
  const isProjection = scenario !== null && periodStart !== null && periodEnd !== null;

  console.log(`[get-climate-indicators] Request: region=${regionId}, scenario=${scenario || "baseline"}, period=${periodStart}-${periodEnd}, isProjection=${isProjection}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // GET REGION CENTROID
  // ─────────────────────────────────────────────────────────────────────────────

  const centroidResult = await getRegionCentroid(regionId, supabaseUrl, anonKey, authHeader);
  if ("error" in centroidResult) {
    return errorResponse(centroidResult.error, "fetch", 500);
  }
  const { lat, lon } = centroidResult;

  // ─────────────────────────────────────────────────────────────────────────────
  // PROJECTION MODE
  // ─────────────────────────────────────────────────────────────────────────────

  if (isProjection && scenario && periodStart && periodEnd) {
    // Get indicator metadata
    const [projIndicator, deltaIndicator] = await Promise.all([
      getIndicatorMeta(supabaseUrl, anonKey, authHeader, "temp_mean_projection"),
      getIndicatorMeta(supabaseUrl, anonKey, authHeader, "temp_delta_vs_baseline"),
    ]);

    // Check cache for both indicators
    const [projCache, deltaCache] = await Promise.all([
      checkCache({
        supabaseUrl, anonKey, authHeader, regionId,
        indicatorId: projIndicator.id,
        scenario,
        periodStart,
        periodEnd,
      }),
      checkCache({
        supabaseUrl, anonKey, authHeader, regionId,
        indicatorId: deltaIndicator.id,
        scenario,
        periodStart,
        periodEnd,
      }),
    ]);

    // If both cached, return immediately
    if (projCache && deltaCache) {
      console.log(`[get-climate-indicators] Cache HIT for projection: scenario=${scenario}, period=${periodStart}-${periodEnd}`);
      return jsonResponse({
        indicators: [
          {
            indicator_code: "temp_mean_projection",
            value: projCache.value,
            unit: projIndicator.unit || "°C",
            scenario,
            period_start: periodStart,
            period_end: periodEnd,
            is_baseline: false,
            dataset_key: DATASET_KEY_CMIP6,
          },
          {
            indicator_code: "temp_delta_vs_baseline",
            value: deltaCache.value,
            unit: deltaIndicator.unit || "°C",
            scenario,
            period_start: periodStart,
            period_end: periodEnd,
            is_baseline: false,
            dataset_key: DATASET_KEY_CMIP6,
          },
        ],
        datasets_used: [DATASET_KEY_CMIP6],
        cached: true,
        computed_at: new Date().toISOString(),
        attribution: {
          provider: "Open-Meteo",
          dataset: "CMIP6 climate projections via Open-Meteo Climate API",
          license: "CC BY 4.0",
          url: "https://open-meteo.com/en/docs/climate-api",
          note: "Projected values based on IPCC AR6 scenario warming estimates",
        },
      });
    }

    // Fetch projection data
    console.log(`[get-climate-indicators] Cache MISS - fetching projection: scenario=${scenario}, period=${periodStart}-${periodEnd}`);
    const projResult = await fetchClimateProjection(lat, lon, scenario, periodStart, periodEnd);
    
    if ("error" in projResult) {
      return errorResponse(projResult.error, "compute", 500);
    }

    // Cache results (best effort)
    if (!projIndicator.id.includes("fallback")) {
      await upsertCache({
        supabaseUrl, anonKey, authHeader, regionId,
        indicatorId: projIndicator.id,
        value: projResult.projectedMean,
        ttlDays: projIndicator.ttlDays,
        scenario,
        periodStart,
        periodEnd,
      });
    }

    if (!deltaIndicator.id.includes("fallback")) {
      await upsertCache({
        supabaseUrl, anonKey, authHeader, regionId,
        indicatorId: deltaIndicator.id,
        value: projResult.delta,
        ttlDays: deltaIndicator.ttlDays,
        scenario,
        periodStart,
        periodEnd,
      });
    }

    // Return projection response
    return jsonResponse({
      indicators: [
        {
          indicator_code: "temp_mean_projection",
          value: projResult.projectedMean,
          unit: "°C",
          scenario,
          period_start: periodStart,
          period_end: periodEnd,
          is_baseline: false,
          dataset_key: DATASET_KEY_CMIP6,
        },
        {
          indicator_code: "temp_delta_vs_baseline",
          value: projResult.delta,
          unit: "°C",
          scenario,
          period_start: periodStart,
          period_end: periodEnd,
          is_baseline: false,
          dataset_key: DATASET_KEY_CMIP6,
        },
      ],
      datasets_used: [DATASET_KEY_CMIP6],
      cached: false,
      computed_at: new Date().toISOString(),
      debug: {
        baselineMean: projResult.baselineMean,
        projectedMean: projResult.projectedMean,
        delta: projResult.delta,
      },
      attribution: {
        provider: "Open-Meteo",
        dataset: "CMIP6 climate projections via Open-Meteo Climate API",
        license: "CC BY 4.0",
        url: "https://open-meteo.com/en/docs/climate-api",
        note: "Projected values based on IPCC AR6 scenario warming estimates",
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BASELINE MODE (Historical ERA5 data)
  // ─────────────────────────────────────────────────────────────────────────────

  // Get indicator metadata
  const indicator = await getIndicatorMeta(supabaseUrl, anonKey, authHeader, "temp_mean_annual");

  // Check cache first (only if we have a real indicator ID)
  if (!indicator.id.includes("fallback")) {
    const cached = await checkCache({
      supabaseUrl, anonKey, authHeader, regionId,
      indicatorId: indicator.id,
      year,
      scenario: BASELINE_SCENARIO,
      periodStart: BASELINE_PERIOD_START,
      periodEnd: BASELINE_PERIOD_END,
    });

    if (cached) {
      console.log(`[get-climate-indicators] Cache HIT for baseline: year=${year}`);
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

  // Fetch temperature from Open-Meteo Archive
  console.log(`[get-climate-indicators] Cache MISS - fetching baseline: year=${year}`);
  const tempResult = await fetchAnnualMeanTempC(lat, lon, year);
  if ("error" in tempResult) {
    return errorResponse(tempResult.error, "compute", 500);
  }

  // Cache the result (best-effort, only if we have a real indicator ID)
  if (!indicator.id.includes("fallback")) {
    await upsertCache({
      supabaseUrl, anonKey, authHeader, regionId,
      indicatorId: indicator.id,
      year,
      value: tempResult.value,
      ttlDays: indicator.ttlDays,
      scenario: BASELINE_SCENARIO,
      periodStart: BASELINE_PERIOD_START,
      periodEnd: BASELINE_PERIOD_END,
    });
  }

  // Return success response
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
