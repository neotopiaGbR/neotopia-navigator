/**
 * IMPORTANT: Your Supabase project is using signing keys (e.g. sb_publishable_* / sb_secret_*).
 * PostgREST expects Authorization: Bearer <JWT>. If we pass sb_secret_* there, it throws:
 *   PGRST301 Expected 3 parts in JWT; got 1
 *
 * Fix: for server-side DB calls from this Edge Function, authenticate via the `apikey` header ONLY.
 * Do not send `Authorization: Bearer <sb_secret_*>`.
 */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const DEFAULT_INDICATOR_CODES = ["temp_mean_annual"];
const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

const DATASET_ERA5 = {
  key: "copernicus_era5_land",
  attribution:
    "Copernicus Climate Change Service (C3S), ERA5-Land hourly data. Licence: CC BY 4.0",
};

type IndicatorMetaRow = {
  id: string;
  code: string;
  unit: string | null;
  default_ttl_days: number | null;
};

type OpenMeteoResponse = {
  daily?: {
    time?: string[];
    temperature_2m_mean?: (number | null)[];
  };
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function badRequest(message: string, details?: unknown) {
  return json({ error: message, details }, 400);
}

function toNumber(x: unknown) {
  const n = typeof x === "string" ? Number(x) : (x as number);
  return Number.isFinite(n) ? n : null;
}

function parsePoint(value: unknown): { lat: number; lon: number } | null {
  if (!value) return null;

  // GeoJSON object
  if (
    typeof value === "object" &&
    value !== null &&
    (value as any).type === "Point" &&
    Array.isArray((value as any).coordinates)
  ) {
    const lon = toNumber((value as any).coordinates[0]);
    const lat = toNumber((value as any).coordinates[1]);
    if (lat === null || lon === null) return null;
    return { lat, lon };
  }

  // String: try JSON first
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      const p = parsePoint(parsed);
      if (p) return p;
    } catch {
      // ignore
    }

    // String WKT: POINT(lon lat)
    const m = value.match(/POINT\s*\(\s*([-0-9.]+)\s+([-0-9.]+)\s*\)/i);
    if (m) {
      const lon = toNumber(m[1]);
      const lat = toNumber(m[2]);
      if (lat === null || lon === null) return null;
      return { lat, lon };
    }
  }

  return null;
}

function getSupabaseUrl(): string | null {
  return Deno.env.get("SUPABASE_URL") || null;
}

function getAnonKey(): string | null {
  return Deno.env.get("SUPABASE_ANON_KEY") || null;
}

function getServiceRoleKey(): string | null {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

/**
 * Make authenticated REST calls to PostgREST.
 * 
 * For Supabase projects with signing keys (sb_publishable_* / sb_secret_*):
 * - Use ONLY the `apikey` header with the service role key
 * - Do NOT use Authorization header (service role key is not a JWT)
 * 
 * The service role key in apikey header bypasses RLS.
 */
async function restJson<T>(
  url: string,
  init: RequestInit,
  serviceRoleKey: string
): Promise<{ data: T; status: number } | { error: string; status: number; body?: string }>
{
  const headers = new Headers(init.headers);
  // For signing-key projects: use service role key in apikey header ONLY
  headers.set("apikey", serviceRoleKey);
  // DO NOT set Authorization header - service role key is not a JWT
  
  const res = await fetch(url, { ...init, headers });
  const status = res.status;
  const text = await res.text();

  if (!res.ok) {
    return { error: `PostgREST error ${status}`, status, body: text };
  }
  try {
    return { data: JSON.parse(text) as T, status };
  } catch {
    // Some endpoints can return empty bodies
    return { data: (undefined as unknown) as T, status };
  }
}

async function fetchAnnualMeanTempC(
  lat: number,
  lon: number,
  year: number
): Promise<{ value: number; dailyCount: number } | { error: string }>
{
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    start_date: startDate,
    end_date: endDate,
    daily: "temperature_2m_mean",
    timezone: "UTC",
  });

  const url = `${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      return { error: `Open-Meteo failed: ${res.status} ${text}` };
    }

    const data = (await res.json()) as OpenMeteoResponse;
    const arr = data?.daily?.temperature_2m_mean ?? [];
    const vals = arr.map(toNumber).filter((v): v is number => v !== null);
    if (!vals.length) return { error: "No temperature data returned" };

    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { value: Math.round(mean * 10) / 10, dailyCount: vals.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error" };
  }
}

async function getRegionCentroid(
  regionId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<{ lat: number; lon: number }>
{
  const url = new URL(`${supabaseUrl}/rest/v1/regions`);
  url.searchParams.set("id", `eq.${regionId}`);
  url.searchParams.set("select", "centroid,geom");
  url.searchParams.set("limit", "1");

  const res = await restJson<Array<{ centroid: unknown; geom: unknown }>>(
    url.toString(),
    { method: "GET" },
    serviceRoleKey
  );

  if ("error" in res) {
    throw new Error(
      `Failed to load region centroid: ${res.status} ${res.body ?? res.error}`
    );
  }

  const row = res.data?.[0];
  if (!row) throw new Error("Region not found");

  const fromCentroid = parsePoint(row.centroid);
  if (fromCentroid) return fromCentroid;

  // Try to compute from GeoJSON geom if available
  const g = row.geom as any;
  if (g && typeof g === "object" && Array.isArray(g.coordinates)) {
    // crude fallback: average first ring points
    const type = g.type;
    let coords: number[][] | null = null;

    if (type === "Polygon") {
      coords = g.coordinates?.[0] ?? null;
    } else if (type === "MultiPolygon") {
      coords = g.coordinates?.[0]?.[0] ?? null;
    }

    if (coords && coords.length) {
      const lons = coords.map((c) => toNumber(c?.[0])).filter((x): x is number => x !== null);
      const lats = coords.map((c) => toNumber(c?.[1])).filter((x): x is number => x !== null);
      if (lons.length && lats.length) {
        return {
          lon: lons.reduce((a, b) => a + b, 0) / lons.length,
          lat: lats.reduce((a, b) => a + b, 0) / lats.length,
        };
      }
    }
  }

  throw new Error("Region centroid missing/invalid");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getServiceRoleKey();
  
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server configuration error: missing env vars" }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const p_region_id = body?.p_region_id ?? body?.region_id;
  const p_scenario = body?.p_scenario ?? null;
  const p_period_start = body?.p_period_start ?? null;
  const p_period_end = body?.p_period_end ?? null;

  const indicatorCodes: string[] = Array.isArray(body?.indicator_codes) && body.indicator_codes.length
    ? body.indicator_codes
    : DEFAULT_INDICATOR_CODES;
  const requestYear: number = typeof body?.year === "number" ? body.year : new Date().getUTCFullYear() - 1;

  if (!p_region_id || typeof p_region_id !== "string") {
    return badRequest("Missing p_region_id (uuid string)");
  }

  const nowIso = new Date().toISOString();

  try {
    const centroid = await getRegionCentroid(p_region_id, supabaseUrl, serviceRoleKey);
    const { lat, lon } = centroid;

    // indicators registry
    const indUrl = new URL(`${supabaseUrl}/rest/v1/indicators`);
    indUrl.searchParams.set("select", "id,code,unit,default_ttl_days");
    indUrl.searchParams.set("code", `in.(${indicatorCodes.join(",")})`);

    const indRes = await restJson<IndicatorMetaRow[]>(indUrl.toString(), { method: "GET" }, serviceRoleKey);
    if ("error" in indRes) {
      return json({ error: `Indicator registry lookup failed: ${indRes.body ?? indRes.error}` }, 500);
    }
    const indicators = indRes.data ?? [];
    const byCode = new Map(indicators.map((i) => [i.code, i]));
    for (const code of indicatorCodes) {
      if (!byCode.has(code)) return badRequest(`Indicator not found: ${code}`);
    }

    // cache lookup
    const indicatorIds = indicators.map((i) => i.id);
    const cacheUrl = new URL(`${supabaseUrl}/rest/v1/indicator_values`);
    cacheUrl.searchParams.set(
      "select",
      "indicator_id,value,year,computed_at,expires_at,source_dataset_key"
    );
    cacheUrl.searchParams.set("region_id", `eq.${p_region_id}`);
    cacheUrl.searchParams.set("year", `eq.${requestYear}`);
    cacheUrl.searchParams.set("indicator_id", `in.(${indicatorIds.join(",")})`);
    cacheUrl.searchParams.set("expires_at", `gt.${nowIso}`);
    cacheUrl.searchParams.set("scenario", "is.null");
    cacheUrl.searchParams.set("period_start", "is.null");
    cacheUrl.searchParams.set("period_end", "is.null");

    const cacheRes = await restJson<any[]>(cacheUrl.toString(), { method: "GET" }, serviceRoleKey);
    const cachedRows = "error" in cacheRes ? [] : cacheRes.data || [];
    const cachedByIndicatorId = new Map<string, any>(cachedRows.map((r) => [r.indicator_id, r]));

    const datasetsUsed = new Set<string>();
    let allCached = true;

    const values: any[] = [];

    for (const code of indicatorCodes) {
      const indicator = byCode.get(code)!;
      const cached = cachedByIndicatorId.get(indicator.id);

      if (cached && typeof cached.value === "number") {
        datasetsUsed.add(cached.source_dataset_key || DATASET_ERA5.key);
        values.push({
          indicator_code: code,
          value: cached.value,
          unit: indicator.unit || "°C",
          scenario: null,
          period_start: requestYear,
          period_end: requestYear,
          is_baseline: true,
          dataset_key: cached.source_dataset_key || DATASET_ERA5.key,
        });
        continue;
      }

      allCached = false;

      if (code !== "temp_mean_annual") {
        values.push({
          indicator_code: code,
          value: null,
          unit: indicator.unit || "",
          scenario: null,
          period_start: requestYear,
          period_end: requestYear,
          is_baseline: true,
          dataset_key: DATASET_ERA5.key,
        });
        continue;
      }

      const computed = await fetchAnnualMeanTempC(lat, lon, requestYear);
      if ("error" in computed) {
        // Keep it JSON + actionable
        return json({ error: computed.error }, 500);
      }

      datasetsUsed.add(DATASET_ERA5.key);

      // upsert cache (best-effort)
      const ttlDays = indicator.default_ttl_days ?? 90;
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

      const upsertUrl = new URL(`${supabaseUrl}/rest/v1/indicator_values`);
      upsertUrl.searchParams.set(
        "on_conflict",
        "indicator_id,region_id,year,scenario,period_start,period_end"
      );

      const payload = {
        indicator_id: indicator.id,
        region_id: p_region_id,
        value: computed.value,
        year: requestYear,
        scenario: null,
        period_start: null,
        period_end: null,
        computed_at: nowIso,
        expires_at: expiresAt,
        stale: false,
        source_dataset_key: DATASET_ERA5.key,
        source_meta: {
          lat,
          lon,
          source_api: "open-meteo",
          daily_readings: computed.dailyCount,
          requested: {
            p_scenario,
            p_period_start,
            p_period_end,
          },
        },
      };

      const upRes = await fetch(upsertUrl.toString(), {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(payload),
      });
      if (!upRes.ok) {
        console.warn("[get-climate-indicators] cache upsert failed", upRes.status, await upRes.text());
      }

      values.push({
        indicator_code: code,
        value: computed.value,
        unit: indicator.unit || "°C",
        scenario: null,
        period_start: requestYear,
        period_end: requestYear,
        is_baseline: true,
        dataset_key: DATASET_ERA5.key,
      });
    }

    // attribution via RPC (best-effort)
    const rpcUrl = `${supabaseUrl}/rest/v1/rpc/get_indicator_sources`;
    const rpcRes = await restJson<any[]>(
      rpcUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p_indicator_codes: indicatorCodes }),
      },
      serviceRoleKey
    );

    const attribution = "error" in rpcRes
      ? [
          {
            indicator_code: "temp_mean_annual",
            dataset_key: DATASET_ERA5.key,
            attribution: DATASET_ERA5.attribution,
          },
        ]
      : (rpcRes.data ?? []);

    return json({
      values,
      attribution,
      datasets_used: Array.from(datasetsUsed),
      cached: allCached,
      computed_at: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unknown error" }, 500);
  }
});
