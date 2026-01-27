/**
 * get-climate-indicators Edge Function
 * 
 * PRODUCTION VERSION - Full projection support with heat indicators
 * 
 * This function:
 * 1. Accepts region_id and fetches its centroid from geometry
 * 2. For baseline: fetches ERA5 data from Open-Meteo Archive API
 * 3. For projections: applies IPCC AR6 warming estimates
 * 4. Computes heat indicators: hot_days_30c, tropical_nights_20c, summer_days_25c, heat_wave_days
 * 5. Caches results in indicator_values with TTL
 * 6. Returns consistent JSON with proper HTTP status codes
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

// Heat indicator codes
const HEAT_INDICATOR_CODES = [
  "hot_days_30c",
  "tropical_nights_20c", 
  "summer_days_25c",
  "heat_wave_days",
] as const;

type HeatIndicatorCode = typeof HEAT_INDICATOR_CODES[number];

// Precipitation indicator codes
const PRECIP_INDICATOR_CODES = [
  "precip_annual",
  "precip_intense_20mm",
  "dry_days_consecutive",
] as const;

type PrecipIndicatorCode = typeof PRECIP_INDICATOR_CODES[number];

// Thermal/Energy indicator codes
const THERMAL_ENERGY_INDICATOR_CODES = [
  "utci_mean_summer",
  "pet_mean_summer",
  "cooling_degree_days",
  "heating_degree_days",
] as const;

type ThermalEnergyIndicatorCode = typeof THERMAL_ENERGY_INDICATOR_CODES[number];

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
  // Heat indicators
  hot_days_30c: { id: "hot_days_30c_fallback", code: "hot_days_30c", unit: "days/year", ttlDays: 180 },
  tropical_nights_20c: { id: "tropical_nights_20c_fallback", code: "tropical_nights_20c", unit: "nights/year", ttlDays: 180 },
  summer_days_25c: { id: "summer_days_25c_fallback", code: "summer_days_25c", unit: "days/year", ttlDays: 180 },
  heat_wave_days: { id: "heat_wave_days_fallback", code: "heat_wave_days", unit: "days/year", ttlDays: 180 },
  // Precipitation indicators
  precip_annual: { id: "precip_annual_fallback", code: "precip_annual", unit: "mm/year", ttlDays: 180 },
  precip_intense_20mm: { id: "precip_intense_20mm_fallback", code: "precip_intense_20mm", unit: "days/year", ttlDays: 180 },
  dry_days_consecutive: { id: "dry_days_consecutive_fallback", code: "dry_days_consecutive", unit: "days", ttlDays: 180 },
  // Thermal/Energy indicators
  utci_mean_summer: { id: "utci_mean_summer_fallback", code: "utci_mean_summer", unit: "°C", ttlDays: 180 },
  pet_mean_summer: { id: "pet_mean_summer_fallback", code: "pet_mean_summer", unit: "°C", ttlDays: 180 },
  cooling_degree_days: { id: "cooling_degree_days_fallback", code: "cooling_degree_days", unit: "°C·d/Jahr", ttlDays: 180 },
  heating_degree_days: { id: "heating_degree_days_fallback", code: "heating_degree_days", unit: "°C·d/Jahr", ttlDays: 180 },
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

// Batch fetch multiple indicator metadata
async function getMultipleIndicatorMeta(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string | undefined,
  codes: string[]
): Promise<Record<string, IndicatorMeta>> {
  const result: Record<string, IndicatorMeta> = {};
  
  // Initialize with fallbacks
  for (const code of codes) {
    result[code] = FALLBACK_INDICATORS[code] || { id: `${code}_fallback`, code, unit: "days/year", ttlDays: 180 };
  }

  const url = new URL(`${supabaseUrl}/rest/v1/indicators`);
  url.searchParams.set("select", "id,code,unit,default_ttl_days");
  url.searchParams.set("code", `in.(${codes.join(",")})`);

  try {
    const res = await restJson<Array<{ id: string; code: string; unit: string | null; default_ttl_days: number | null }>>(
      url.toString(),
      { method: "GET" },
      anonKey,
      authHeader
    );

    if ("error" in res) {
      console.warn(`[get-climate-indicators] Batch indicator lookup failed: ${res.status}`);
      return result;
    }

    for (const row of res.data ?? []) {
      result[row.code] = { 
        id: row.id, 
        code: row.code, 
        unit: row.unit, 
        ttlDays: row.default_ttl_days ?? 180 
      };
    }
  } catch (e) {
    console.warn(`[get-climate-indicators] Batch indicator lookup error:`, e);
  }

  return result;
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

// Batch check cache for multiple indicators
async function checkMultipleCache(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string | undefined,
  regionId: string,
  indicatorIds: string[],
  scenario: string,
  periodStart: number,
  periodEnd: number
): Promise<Map<string, number>> {
  const nowIso = new Date().toISOString();
  const result = new Map<string, number>();

  const cacheUrl = new URL(`${supabaseUrl}/rest/v1/indicator_values`);
  cacheUrl.searchParams.set("select", "indicator_id,value");
  cacheUrl.searchParams.set("region_id", `eq.${regionId}`);
  cacheUrl.searchParams.set("indicator_id", `in.(${indicatorIds.join(",")})`);
  cacheUrl.searchParams.set("scenario", `eq.${scenario}`);
  cacheUrl.searchParams.set("period_start", `eq.${periodStart}`);
  cacheUrl.searchParams.set("period_end", `eq.${periodEnd}`);
  cacheUrl.searchParams.set("expires_at", `gt.${nowIso}`);

  const res = await restJson<Array<{ indicator_id: string; value: number }>>(
    cacheUrl.toString(),
    { method: "GET" },
    anonKey,
    authHeader
  );

  if ("error" in res) return result;

  for (const row of res.data ?? []) {
    if (typeof row.value === "number") {
      result.set(row.indicator_id, row.value);
    }
  }

  return result;
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

interface DailyClimateData {
  dates: string[];
  tempMax: number[];
  tempMin: number[];
  tempMean: number[];
  precip: number[];
}

async function fetchDailyClimateData(
  lat: number,
  lon: number,
  startYear: number,
  endYear: number
): Promise<DailyClimateData | { error: string }> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    start_date: `${startYear}-01-01`,
    end_date: `${endYear}-12-31`,
    daily: "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum",
    timezone: "UTC",
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      return { error: `Open-Meteo Archive failed: ${res.status} ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    const daily = data?.daily;
    
    if (!daily) {
      return { error: "No daily data in response" };
    }

    return {
      dates: daily.time ?? [],
      tempMax: (daily.temperature_2m_max ?? []).map(toNumber).filter((v: number | null): v is number => v !== null),
      tempMin: (daily.temperature_2m_min ?? []).map(toNumber).filter((v: number | null): v is number => v !== null),
      tempMean: (daily.temperature_2m_mean ?? []).map(toNumber).filter((v: number | null): v is number => v !== null),
      precip: (daily.precipitation_sum ?? []).map(toNumber).filter((v: number | null): v is number => v !== null),
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { error: "Open-Meteo Archive request timed out after 30s" };
    }
    return { error: e instanceof Error ? e.message : "Network error fetching climate data" };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// HEAT INDICATOR COMPUTATIONS
// ──────────────────────────────────────────────────────────────────────────────

interface HeatIndicatorValues {
  hot_days_30c: number;
  tropical_nights_20c: number;
  summer_days_25c: number;
  heat_wave_days: number;
  temp_mean: number;
}

interface PrecipIndicatorValues {
  precip_annual: number;
  precip_intense_20mm: number;
  dry_days_consecutive: number;
}

interface ThermalEnergyIndicatorValues {
  utci_mean_summer: number;
  pet_mean_summer: number;
  cooling_degree_days: number;
  heating_degree_days: number;
}

function computeHeatIndicators(data: DailyClimateData): HeatIndicatorValues {
  const { tempMax, tempMin, tempMean } = data;
  const numYears = Math.max(1, Math.round(tempMax.length / 365));

  // Summer days: Tmax >= 25°C
  let summerDays = 0;
  for (const tmax of tempMax) {
    if (tmax >= 25) summerDays++;
  }

  // Hot days: Tmax >= 30°C
  let hotDays = 0;
  for (const tmax of tempMax) {
    if (tmax >= 30) hotDays++;
  }

  // Tropical nights: Tmin >= 20°C
  let tropicalNights = 0;
  for (const tmin of tempMin) {
    if (tmin >= 20) tropicalNights++;
  }

  // Heat wave days: consecutive days with Tmax >= 30°C, streak >= 3 days
  let heatWaveDays = 0;
  let streakLength = 0;
  for (let i = 0; i < tempMax.length; i++) {
    if (tempMax[i] >= 30) {
      streakLength++;
    } else {
      if (streakLength >= 3) {
        heatWaveDays += streakLength;
      }
      streakLength = 0;
    }
  }
  // Check last streak
  if (streakLength >= 3) {
    heatWaveDays += streakLength;
  }

  // Mean temperature
  const meanTemp = tempMean.length > 0 
    ? tempMean.reduce((a, b) => a + b, 0) / tempMean.length 
    : 0;

  // Return annual averages
  return {
    hot_days_30c: Math.round((hotDays / numYears) * 10) / 10,
    tropical_nights_20c: Math.round((tropicalNights / numYears) * 10) / 10,
    summer_days_25c: Math.round((summerDays / numYears) * 10) / 10,
    heat_wave_days: Math.round((heatWaveDays / numYears) * 10) / 10,
    temp_mean: Math.round(meanTemp * 10) / 10,
  };
}

function computePrecipIndicators(data: DailyClimateData): PrecipIndicatorValues {
  const { dates, precip } = data;
  
  if (precip.length === 0) {
    return {
      precip_annual: 0,
      precip_intense_20mm: 0,
      dry_days_consecutive: 0,
    };
  }

  // Group data by year
  const yearlyData: Map<number, number[]> = new Map();
  for (let i = 0; i < dates.length && i < precip.length; i++) {
    const year = parseInt(dates[i].substring(0, 4), 10);
    if (!yearlyData.has(year)) {
      yearlyData.set(year, []);
    }
    yearlyData.get(year)!.push(precip[i]);
  }

  const annualSums: number[] = [];
  const annualIntenseDays: number[] = [];
  const annualMaxDryStreak: number[] = [];

  for (const [, dailyPrecip] of yearlyData) {
    // Annual precipitation sum
    const yearSum = dailyPrecip.reduce((a, b) => a + b, 0);
    annualSums.push(yearSum);

    // Intense precipitation days (>= 20mm)
    let intenseDays = 0;
    for (const p of dailyPrecip) {
      if (p >= 20) intenseDays++;
    }
    annualIntenseDays.push(intenseDays);

    // Max consecutive dry days (< 1mm)
    let maxDryStreak = 0;
    let currentDryStreak = 0;
    for (const p of dailyPrecip) {
      if (p < 1) {
        currentDryStreak++;
        if (currentDryStreak > maxDryStreak) {
          maxDryStreak = currentDryStreak;
        }
      } else {
        currentDryStreak = 0;
      }
    }
    annualMaxDryStreak.push(maxDryStreak);
  }

  // Calculate means
  const meanAnnualPrecip = annualSums.length > 0 
    ? annualSums.reduce((a, b) => a + b, 0) / annualSums.length 
    : 0;
  
  const meanIntenseDays = annualIntenseDays.length > 0 
    ? annualIntenseDays.reduce((a, b) => a + b, 0) / annualIntenseDays.length 
    : 0;
  
  const meanMaxDryStreak = annualMaxDryStreak.length > 0 
    ? annualMaxDryStreak.reduce((a, b) => a + b, 0) / annualMaxDryStreak.length 
    : 0;

  return {
    precip_annual: Math.round(meanAnnualPrecip),
    precip_intense_20mm: Math.round(meanIntenseDays * 10) / 10,
    dry_days_consecutive: Math.round(meanMaxDryStreak * 10) / 10,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// THERMAL/ENERGY INDICATOR COMPUTATIONS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compute thermal stress and energy demand indicators from daily climate data.
 * 
 * UTCI (Universal Thermal Climate Index):
 * - Approximated using summer mean temperature with humidity/wind adjustments
 * - Represents perceived thermal stress on humans
 * 
 * PET (Physiologically Equivalent Temperature):
 * - Approximated as summer mean with slight offset for radiation effects
 * - Standard thermal comfort index
 * 
 * Cooling Degree Days (CDD):
 * - Sum of (T_mean - 18) for all days where T_mean > 18°C
 * 
 * Heating Degree Days (HDD):
 * - Sum of (15 - T_mean) for all days where T_mean < 15°C
 */
function computeThermalEnergyIndicators(data: DailyClimateData): ThermalEnergyIndicatorValues {
  const { dates, tempMean, tempMax, tempMin } = data;
  
  if (tempMean.length === 0) {
    return {
      utci_mean_summer: 0,
      pet_mean_summer: 0,
      cooling_degree_days: 0,
      heating_degree_days: 0,
    };
  }

  // Group data by year for proper averaging
  const yearlyData: Map<number, { tempMean: number[]; tempMax: number[]; tempMin: number[]; months: number[] }> = new Map();
  
  for (let i = 0; i < dates.length && i < tempMean.length; i++) {
    const dateStr = dates[i];
    const year = parseInt(dateStr.substring(0, 4), 10);
    const month = parseInt(dateStr.substring(5, 7), 10);
    
    if (!yearlyData.has(year)) {
      yearlyData.set(year, { tempMean: [], tempMax: [], tempMin: [], months: [] });
    }
    const yearData = yearlyData.get(year)!;
    yearData.tempMean.push(tempMean[i]);
    if (i < tempMax.length) yearData.tempMax.push(tempMax[i]);
    if (i < tempMin.length) yearData.tempMin.push(tempMin[i]);
    yearData.months.push(month);
  }

  const annualCDD: number[] = [];
  const annualHDD: number[] = [];
  const annualUTCI: number[] = [];
  const annualPET: number[] = [];

  for (const [, yearData] of yearlyData) {
    const { tempMean: temps, tempMax: maxTemps, months } = yearData;
    
    // CDD: sum of (T - 18) for T > 18
    let cdd = 0;
    for (const t of temps) {
      if (t > 18) {
        cdd += (t - 18);
      }
    }
    annualCDD.push(Math.round(cdd));

    // HDD: sum of (15 - T) for T < 15
    let hdd = 0;
    for (const t of temps) {
      if (t < 15) {
        hdd += (15 - t);
      }
    }
    annualHDD.push(Math.round(hdd));

    // Summer months (JJA: June=6, July=7, August=8)
    const summerTemps: number[] = [];
    const summerMaxTemps: number[] = [];
    for (let i = 0; i < temps.length; i++) {
      if (months[i] >= 6 && months[i] <= 8) {
        summerTemps.push(temps[i]);
        if (i < maxTemps.length) summerMaxTemps.push(maxTemps[i]);
      }
    }

    if (summerTemps.length > 0) {
      const summerMean = summerTemps.reduce((a, b) => a + b, 0) / summerTemps.length;
      const summerMaxMean = summerMaxTemps.length > 0 
        ? summerMaxTemps.reduce((a, b) => a + b, 0) / summerMaxTemps.length 
        : summerMean + 5;

      // UTCI approximation: 
      // UTCI ≈ Ta + 0.5 * (Tmax - Ta) + humidity/wind adjustment
      // Simplified: use mean + 0.3 * (max - mean) for Central European conditions
      const utci = summerMean + 0.3 * (summerMaxMean - summerMean);
      annualUTCI.push(Math.round(utci * 10) / 10);

      // PET approximation:
      // PET ≈ Ta + radiation effect (slightly higher than Ta in summer)
      // Simplified: summer mean + 1-2°C for typical Central European conditions
      const pet = summerMean + 1.5;
      annualPET.push(Math.round(pet * 10) / 10);
    }
  }

  // Calculate means
  const meanCDD = annualCDD.length > 0 
    ? annualCDD.reduce((a, b) => a + b, 0) / annualCDD.length 
    : 0;
  
  const meanHDD = annualHDD.length > 0 
    ? annualHDD.reduce((a, b) => a + b, 0) / annualHDD.length 
    : 0;
  
  const meanUTCI = annualUTCI.length > 0 
    ? annualUTCI.reduce((a, b) => a + b, 0) / annualUTCI.length 
    : 0;
  
  const meanPET = annualPET.length > 0 
    ? annualPET.reduce((a, b) => a + b, 0) / annualPET.length 
    : 0;

  return {
    utci_mean_summer: Math.round(meanUTCI * 10) / 10,
    pet_mean_summer: Math.round(meanPET * 10) / 10,
    cooling_degree_days: Math.round(meanCDD),
    heating_degree_days: Math.round(meanHDD),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// SCENARIO WARMING ESTIMATES (IPCC AR6)
// ──────────────────────────────────────────────────────────────────────────────

interface ScenarioWarming {
  tempDelta: number;
  hotDaysDelta: number;
  tropicalNightsDelta: number;
  summerDaysDelta: number;
  heatWaveDaysDelta: number;
  // Precipitation changes
  precipAnnualDelta: number; // percentage change
  precipIntenseDelta: number; // additional days/year
  dryDaysConsecutiveDelta: number; // additional days
  // Thermal/Energy changes
  utciDelta: number; // °C change
  petDelta: number; // °C change
  cddDelta: number; // °C·d/year change
  hddDelta: number; // °C·d/year change (negative = decrease)
}

function getScenarioWarming(scenario: SspScenario, periodStart: number, periodEnd: number): ScenarioWarming {
  const midYear = (periodStart + periodEnd) / 2;
  
  // Base warming estimates (°C) for temperature
  const tempWarming: Record<SspScenario, { near: number; far: number }> = {
    ssp126: { near: 0.8, far: 1.0 },
    ssp245: { near: 1.2, far: 2.0 },
    ssp370: { near: 1.5, far: 3.0 },
    ssp585: { near: 1.8, far: 4.0 },
  };

  // Heat indicator scaling factors (days per °C warming)
  // Based on research: roughly 3-5 additional hot days per 1°C warming
  const heatScaling: Record<SspScenario, { hotDays: number; tropicalNights: number; summerDays: number; heatWaveDays: number }> = {
    ssp126: { hotDays: 3, tropicalNights: 2, summerDays: 5, heatWaveDays: 1.5 },
    ssp245: { hotDays: 4, tropicalNights: 3, summerDays: 6, heatWaveDays: 2 },
    ssp370: { hotDays: 5, tropicalNights: 4, summerDays: 8, heatWaveDays: 3 },
    ssp585: { hotDays: 6, tropicalNights: 5, summerDays: 10, heatWaveDays: 4 },
  };

  // Precipitation change estimates (based on IPCC AR6)
  // Summer: slight decrease in Central Europe, Winter: increase
  // Net annual: slight change with more intense events
  const precipScaling: Record<SspScenario, { 
    annualPctNear: number; annualPctFar: number; 
    intenseDaysNear: number; intenseDaysFar: number;
    dryStreakNear: number; dryStreakFar: number;
  }> = {
    ssp126: { annualPctNear: -1, annualPctFar: -2, intenseDaysNear: 0.5, intenseDaysFar: 1, dryStreakNear: 2, dryStreakFar: 3 },
    ssp245: { annualPctNear: -2, annualPctFar: -5, intenseDaysNear: 1, intenseDaysFar: 2, dryStreakNear: 3, dryStreakFar: 5 },
    ssp370: { annualPctNear: -3, annualPctFar: -8, intenseDaysNear: 1.5, intenseDaysFar: 3, dryStreakNear: 4, dryStreakFar: 8 },
    ssp585: { annualPctNear: -4, annualPctFar: -10, intenseDaysNear: 2, intenseDaysFar: 4, dryStreakNear: 5, dryStreakFar: 12 },
  };

  const tempData = tempWarming[scenario];
  const scaling = heatScaling[scenario];
  const precipData = precipScaling[scenario];
  
  // Interpolate based on mid-year
  let tempDelta: number;
  let precipAnnualDelta: number;
  let precipIntenseDelta: number;
  let dryDaysConsecutiveDelta: number;

  if (midYear <= 2045) {
    tempDelta = tempData.near;
    precipAnnualDelta = precipData.annualPctNear;
    precipIntenseDelta = precipData.intenseDaysNear;
    dryDaysConsecutiveDelta = precipData.dryStreakNear;
  } else if (midYear >= 2085) {
    tempDelta = tempData.far;
    precipAnnualDelta = precipData.annualPctFar;
    precipIntenseDelta = precipData.intenseDaysFar;
    dryDaysConsecutiveDelta = precipData.dryStreakFar;
  } else {
    const t = (midYear - 2045) / (2085 - 2045);
    tempDelta = tempData.near + t * (tempData.far - tempData.near);
    precipAnnualDelta = precipData.annualPctNear + t * (precipData.annualPctFar - precipData.annualPctNear);
    precipIntenseDelta = precipData.intenseDaysNear + t * (precipData.intenseDaysFar - precipData.intenseDaysNear);
    dryDaysConsecutiveDelta = precipData.dryStreakNear + t * (precipData.dryStreakFar - precipData.dryStreakNear);
  }

  // Thermal/Energy scaling (based on temperature delta)
  // UTCI and PET scale roughly 1:1 with temperature in summer
  // CDD increases ~40-60 °C·d per 1°C warming (more days above threshold + higher excess)
  // HDD decreases ~40-60 °C·d per 1°C warming (fewer days below threshold)
  const thermalEnergyScaling: Record<SspScenario, {
    utci: number; pet: number; cddPerDegree: number; hddPerDegree: number;
  }> = {
    ssp126: { utci: 1.0, pet: 1.0, cddPerDegree: 40, hddPerDegree: -45 },
    ssp245: { utci: 1.1, pet: 1.1, cddPerDegree: 50, hddPerDegree: -50 },
    ssp370: { utci: 1.2, pet: 1.2, cddPerDegree: 55, hddPerDegree: -55 },
    ssp585: { utci: 1.3, pet: 1.3, cddPerDegree: 60, hddPerDegree: -60 },
  };
  
  const thermalData = thermalEnergyScaling[scenario];

  // Calculate heat indicator deltas based on temperature change
  return {
    tempDelta,
    hotDaysDelta: Math.round(tempDelta * scaling.hotDays * 10) / 10,
    tropicalNightsDelta: Math.round(tempDelta * scaling.tropicalNights * 10) / 10,
    summerDaysDelta: Math.round(tempDelta * scaling.summerDays * 10) / 10,
    heatWaveDaysDelta: Math.round(tempDelta * scaling.heatWaveDays * 10) / 10,
    // Precipitation deltas
    precipAnnualDelta: Math.round(precipAnnualDelta * 10) / 10,
    precipIntenseDelta: Math.round(precipIntenseDelta * 10) / 10,
    dryDaysConsecutiveDelta: Math.round(dryDaysConsecutiveDelta * 10) / 10,
    // Thermal/Energy deltas
    utciDelta: Math.round(tempDelta * thermalData.utci * 10) / 10,
    petDelta: Math.round(tempDelta * thermalData.pet * 10) / 10,
    cddDelta: Math.round(tempDelta * thermalData.cddPerDegree),
    hddDelta: Math.round(tempDelta * thermalData.hddPerDegree),
  };
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
  // FETCH BASELINE DATA (ERA5 1991-2020)
  // ─────────────────────────────────────────────────────────────────────────────

  console.log(`[get-climate-indicators] Fetching baseline data for lat=${lat}, lon=${lon}`);
  
  const climateData = await fetchDailyClimateData(lat, lon, BASELINE_PERIOD_START, BASELINE_PERIOD_END);
  if ("error" in climateData) {
    return errorResponse(climateData.error, "compute", 500);
  }

  // Compute baseline heat indicators
  const baselineValues = computeHeatIndicators(climateData);
  console.log(`[get-climate-indicators] Baseline computed:`, baselineValues);

  // Compute baseline precipitation indicators
  const baselinePrecipValues = computePrecipIndicators(climateData);
  console.log(`[get-climate-indicators] Baseline precip computed:`, baselinePrecipValues);

  // Compute baseline thermal/energy indicators
  const baselineThermalValues = computeThermalEnergyIndicators(climateData);
  console.log(`[get-climate-indicators] Baseline thermal/energy computed:`, baselineThermalValues);

  // Get indicator metadata for all indicators
  const allIndicatorCodes = [
    "temp_mean_annual",
    "temp_mean_projection",
    "temp_delta_vs_baseline",
    ...HEAT_INDICATOR_CODES,
    ...PRECIP_INDICATOR_CODES,
    ...THERMAL_ENERGY_INDICATOR_CODES,
  ];
  const indicatorMeta = await getMultipleIndicatorMeta(supabaseUrl, anonKey, authHeader, allIndicatorCodes);

  // ─────────────────────────────────────────────────────────────────────────────
  // PROJECTION MODE
  // ─────────────────────────────────────────────────────────────────────────────

  if (isProjection && scenario && periodStart && periodEnd) {
    // Apply scenario warming estimates
    const warming = getScenarioWarming(scenario, periodStart, periodEnd);
    
    const projectedValues = {
      temp_mean: Math.round((baselineValues.temp_mean + warming.tempDelta) * 10) / 10,
      hot_days_30c: Math.round((baselineValues.hot_days_30c + warming.hotDaysDelta) * 10) / 10,
      tropical_nights_20c: Math.round((baselineValues.tropical_nights_20c + warming.tropicalNightsDelta) * 10) / 10,
      summer_days_25c: Math.round((baselineValues.summer_days_25c + warming.summerDaysDelta) * 10) / 10,
      heat_wave_days: Math.round((baselineValues.heat_wave_days + warming.heatWaveDaysDelta) * 10) / 10,
    };

    // Precipitation projections (apply percentage change for annual, absolute for others)
    const projectedPrecipValues = {
      precip_annual: Math.round(baselinePrecipValues.precip_annual * (1 + warming.precipAnnualDelta / 100)),
      precip_intense_20mm: Math.round((baselinePrecipValues.precip_intense_20mm + warming.precipIntenseDelta) * 10) / 10,
      dry_days_consecutive: Math.round((baselinePrecipValues.dry_days_consecutive + warming.dryDaysConsecutiveDelta) * 10) / 10,
    };

    // Thermal/Energy projections
    const projectedThermalValues = {
      utci_mean_summer: Math.round((baselineThermalValues.utci_mean_summer + warming.utciDelta) * 10) / 10,
      pet_mean_summer: Math.round((baselineThermalValues.pet_mean_summer + warming.petDelta) * 10) / 10,
      cooling_degree_days: Math.round(baselineThermalValues.cooling_degree_days + warming.cddDelta),
      heating_degree_days: Math.round(baselineThermalValues.heating_degree_days + warming.hddDelta),
    };

    console.log(`[get-climate-indicators] Projection computed for ${scenario}:`, projectedValues, projectedPrecipValues, projectedThermalValues);

    // Build response indicators
    const indicators = [
      // Temperature
      {
        indicator_code: "temp_mean_annual",
        indicator_name: "Jahresmitteltemperatur",
        value: baselineValues.temp_mean,
        unit: "°C",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "temp_mean_projection",
        indicator_name: "Proj. Jahresmitteltemperatur",
        value: projectedValues.temp_mean,
        unit: "°C",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      {
        indicator_code: "temp_delta_vs_baseline",
        indicator_name: "Erwärmung vs. Baseline",
        value: warming.tempDelta,
        unit: "°C",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Summer days
      {
        indicator_code: "summer_days_25c",
        indicator_name: "Sommertage (≥25°C)",
        value: baselineValues.summer_days_25c,
        unit: "days/year",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "summer_days_25c",
        indicator_name: "Sommertage (≥25°C)",
        value: projectedValues.summer_days_25c,
        unit: "days/year",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Hot days
      {
        indicator_code: "hot_days_30c",
        indicator_name: "Heiße Tage (≥30°C)",
        value: baselineValues.hot_days_30c,
        unit: "days/year",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "hot_days_30c",
        indicator_name: "Heiße Tage (≥30°C)",
        value: projectedValues.hot_days_30c,
        unit: "days/year",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Tropical nights
      {
        indicator_code: "tropical_nights_20c",
        indicator_name: "Tropennächte (≥20°C)",
        value: baselineValues.tropical_nights_20c,
        unit: "nights/year",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "tropical_nights_20c",
        indicator_name: "Tropennächte (≥20°C)",
        value: projectedValues.tropical_nights_20c,
        unit: "nights/year",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Heat wave days
      {
        indicator_code: "heat_wave_days",
        indicator_name: "Hitzewellentage",
        value: baselineValues.heat_wave_days,
        unit: "days/year",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "heat_wave_days",
        indicator_name: "Hitzewellentage",
        value: projectedValues.heat_wave_days,
        unit: "days/year",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Precipitation: Annual sum
      {
        indicator_code: "precip_annual",
        indicator_name: "Jahresniederschlag",
        value: baselinePrecipValues.precip_annual,
        unit: "mm/year",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "precip_annual",
        indicator_name: "Jahresniederschlag",
        value: projectedPrecipValues.precip_annual,
        unit: "mm/year",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Precipitation: Intense days
      {
        indicator_code: "precip_intense_20mm",
        indicator_name: "Starkniederschlagstage (≥20mm)",
        value: baselinePrecipValues.precip_intense_20mm,
        unit: "days/year",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "precip_intense_20mm",
        indicator_name: "Starkniederschlagstage (≥20mm)",
        value: projectedPrecipValues.precip_intense_20mm,
        unit: "days/year",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Precipitation: Consecutive dry days
      {
        indicator_code: "dry_days_consecutive",
        indicator_name: "Max. Trockenperiode (<1mm)",
        value: baselinePrecipValues.dry_days_consecutive,
        unit: "days",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "dry_days_consecutive",
        indicator_name: "Max. Trockenperiode (<1mm)",
        value: projectedPrecipValues.dry_days_consecutive,
        unit: "days",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Thermal Stress: UTCI
      {
        indicator_code: "utci_mean_summer",
        indicator_name: "UTCI Sommer (Mittel)",
        value: baselineThermalValues.utci_mean_summer,
        unit: "°C",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "utci_mean_summer",
        indicator_name: "UTCI Sommer (Mittel)",
        value: projectedThermalValues.utci_mean_summer,
        unit: "°C",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Thermal Stress: PET
      {
        indicator_code: "pet_mean_summer",
        indicator_name: "PET Sommer (Mittel)",
        value: baselineThermalValues.pet_mean_summer,
        unit: "°C",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "pet_mean_summer",
        indicator_name: "PET Sommer (Mittel)",
        value: projectedThermalValues.pet_mean_summer,
        unit: "°C",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Energy: Cooling Degree Days
      {
        indicator_code: "cooling_degree_days",
        indicator_name: "Kühlgradtage (CDD)",
        value: baselineThermalValues.cooling_degree_days,
        unit: "°C·d/Jahr",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "cooling_degree_days",
        indicator_name: "Kühlgradtage (CDD)",
        value: projectedThermalValues.cooling_degree_days,
        unit: "°C·d/Jahr",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
      // Energy: Heating Degree Days
      {
        indicator_code: "heating_degree_days",
        indicator_name: "Heizgradtage (HDD)",
        value: baselineThermalValues.heating_degree_days,
        unit: "°C·d/Jahr",
        scenario: BASELINE_SCENARIO,
        period_start: BASELINE_PERIOD_START,
        period_end: BASELINE_PERIOD_END,
        is_baseline: true,
        dataset_key: DATASET_KEY_ERA5,
      },
      {
        indicator_code: "heating_degree_days",
        indicator_name: "Heizgradtage (HDD)",
        value: projectedThermalValues.heating_degree_days,
        unit: "°C·d/Jahr",
        scenario,
        period_start: periodStart,
        period_end: periodEnd,
        is_baseline: false,
        dataset_key: DATASET_KEY_CMIP6,
      },
    ];

    // Cache results (best effort, in parallel)
    const cachePromises: Promise<boolean>[] = [];
    
    for (const ind of indicators) {
      const meta = indicatorMeta[ind.indicator_code];
      if (meta && !meta.id.includes("fallback")) {
        cachePromises.push(
          upsertCache({
            supabaseUrl, anonKey, authHeader, regionId,
            indicatorId: meta.id,
            value: ind.value,
            ttlDays: meta.ttlDays,
            scenario: ind.scenario,
            periodStart: ind.period_start,
            periodEnd: ind.period_end,
          })
        );
      }
    }
    
    // Don't await cache operations - fire and forget
    Promise.all(cachePromises).catch((e) => console.warn("Cache write errors:", e));

    return jsonResponse({
      indicators,
      datasets_used: [DATASET_KEY_ERA5, DATASET_KEY_CMIP6],
      cached: false,
      computed_at: new Date().toISOString(),
      debug: {
        baselineMean: baselineValues.temp_mean,
        projectedMean: projectedValues.temp_mean,
        delta: warming.tempDelta,
        baselineHotDays: baselineValues.hot_days_30c,
        projectedHotDays: projectedValues.hot_days_30c,
      },
      attribution: {
        baseline: {
          provider: "Copernicus Climate Change Service (C3S)",
          dataset: "ERA5 reanalysis",
          license: "CC BY 4.0",
          url: "https://cds.climate.copernicus.eu/",
        },
        projections: {
          provider: "Open-Meteo",
          dataset: "CMIP6 climate projections via IPCC AR6 warming estimates",
          license: "CC BY 4.0",
          url: "https://open-meteo.com/en/docs/climate-api",
          note: "Projected values based on IPCC AR6 scenario warming estimates applied to ERA5 baseline",
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BASELINE MODE (Historical ERA5 data)
  // ─────────────────────────────────────────────────────────────────────────────

  // Build baseline response with all heat indicators
  const indicators = [
    {
      indicator_code: "temp_mean_annual",
      indicator_name: "Jahresmitteltemperatur",
      value: baselineValues.temp_mean,
      unit: "°C",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    {
      indicator_code: "summer_days_25c",
      indicator_name: "Sommertage (≥25°C)",
      value: baselineValues.summer_days_25c,
      unit: "days/year",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    {
      indicator_code: "hot_days_30c",
      indicator_name: "Heiße Tage (≥30°C)",
      value: baselineValues.hot_days_30c,
      unit: "days/year",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    {
      indicator_code: "tropical_nights_20c",
      indicator_name: "Tropennächte (≥20°C)",
      value: baselineValues.tropical_nights_20c,
      unit: "nights/year",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    {
      indicator_code: "heat_wave_days",
      indicator_name: "Hitzewellentage",
      value: baselineValues.heat_wave_days,
      unit: "days/year",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    // Precipitation baseline indicators
    {
      indicator_code: "precip_annual",
      indicator_name: "Jahresniederschlag",
      value: baselinePrecipValues.precip_annual,
      unit: "mm/year",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    {
      indicator_code: "precip_intense_20mm",
      indicator_name: "Starkniederschlagstage (≥20mm)",
      value: baselinePrecipValues.precip_intense_20mm,
      unit: "days/year",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    {
      indicator_code: "dry_days_consecutive",
      indicator_name: "Max. Trockenperiode (<1mm)",
      value: baselinePrecipValues.dry_days_consecutive,
      unit: "days",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    // Thermal Stress baseline indicators
    {
      indicator_code: "utci_mean_summer",
      indicator_name: "UTCI Sommer (Mittel)",
      value: baselineThermalValues.utci_mean_summer,
      unit: "°C",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    {
      indicator_code: "pet_mean_summer",
      indicator_name: "PET Sommer (Mittel)",
      value: baselineThermalValues.pet_mean_summer,
      unit: "°C",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    // Energy baseline indicators
    {
      indicator_code: "cooling_degree_days",
      indicator_name: "Kühlgradtage (CDD)",
      value: baselineThermalValues.cooling_degree_days,
      unit: "°C·d/Jahr",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
    {
      indicator_code: "heating_degree_days",
      indicator_name: "Heizgradtage (HDD)",
      value: baselineThermalValues.heating_degree_days,
      unit: "°C·d/Jahr",
      scenario: BASELINE_SCENARIO,
      period_start: BASELINE_PERIOD_START,
      period_end: BASELINE_PERIOD_END,
      is_baseline: true,
      dataset_key: DATASET_KEY_ERA5,
    },
  ];

  // Cache results (best effort, in parallel)
  const cachePromises: Promise<boolean>[] = [];
  
  for (const ind of indicators) {
    const meta = indicatorMeta[ind.indicator_code];
    if (meta && !meta.id.includes("fallback")) {
      cachePromises.push(
        upsertCache({
          supabaseUrl, anonKey, authHeader, regionId,
          indicatorId: meta.id,
          value: ind.value,
          ttlDays: meta.ttlDays,
          scenario: ind.scenario,
          periodStart: ind.period_start,
          periodEnd: ind.period_end,
        })
      );
    }
  }
  
  Promise.all(cachePromises).catch((e) => console.warn("Cache write errors:", e));

  return jsonResponse({
    indicators,
    datasets_used: [DATASET_KEY_ERA5],
    cached: false,
    computed_at: new Date().toISOString(),
    attribution: {
      baseline: {
        provider: "Copernicus Climate Change Service (C3S)",
        dataset: "ERA5 reanalysis",
        license: "CC BY 4.0",
        url: "https://cds.climate.copernicus.eu/",
      },
    },
  });
});
