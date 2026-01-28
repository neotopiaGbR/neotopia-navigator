/**
 * DWD HYRAS-DE Air Temperature - Health Check Edge Function
 *
 * Purpose:
 * - Provide a definitive, always-JSON health endpoint for the DWD layer.
 * - Validate Edge Function reachability (CORS/OPTIONS) and upstream DWD availability.
 *
 * This function does NOT require database access.
 */

const FUNCTION_NAME = 'dwd-health';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': [
    'authorization',
    'apikey',
    'content-type',
    'range',
    'x-client-info',
    'x-supabase-client-platform',
    'x-supabase-client-platform-version',
    'x-supabase-client-runtime',
    'x-supabase-client-runtime-version',
  ].join(', '),
  'Access-Control-Expose-Headers': [
    'Content-Range',
    'Accept-Ranges',
    'Content-Length',
    'Content-Type',
  ].join(', '),
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function safeJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return (v && typeof v === 'object') ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getProjectRefFromSupabaseUrl(supabaseUrl: string | null): string | null {
  if (!supabaseUrl) return null;
  try {
    const host = new URL(supabaseUrl).hostname; // <ref>.supabase.co
    return host.split('.')[0] || null;
  } catch {
    return null;
  }
}

// DWD CDC base URLs
const DWD_BASE_URL = 'https://opendata.dwd.de/climate_environment/CDC/grids_germany/seasonal';
const VARIABLE_PATHS: Record<string, string> = {
  mean: 'air_temperature_mean/14_JJA',
  max: 'air_temperature_max/14_JJA',
  min: 'air_temperature_min/14_JJA',
};

function buildDwdUrl(year: number, variable: 'mean' | 'max' | 'min'): string {
  const path = VARIABLE_PATHS[variable];
  const filename = `grids_germany_seasonal_air_temp_${variable}_${year}14.asc.gz`;
  return `${DWD_BASE_URL}/${path}/${filename}`;
}

async function probeDwdUrl(url: string): Promise<{
  attemptedUrl: string;
  method: 'HEAD' | 'GET_RANGE';
  status: number | null;
  ok: boolean;
  contentType: string | null;
  contentLength: string | null;
  contentRange: string | null;
  error: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), 12_000);

  const commonInit: RequestInit = {
    redirect: 'follow',
    signal: controller.signal,
    headers: {
      'User-Agent': 'Neotopia Navigator / DWD Data Access (health)',
    },
  };

  try {
    // Prefer HEAD to avoid downloading large payloads.
    const headRes = await fetch(url, { ...commonInit, method: 'HEAD' });
    const contentType = headRes.headers.get('content-type');
    const contentLength = headRes.headers.get('content-length');
    const contentRange = headRes.headers.get('content-range');

    return {
      attemptedUrl: url,
      method: 'HEAD',
      status: headRes.status,
      ok: headRes.ok,
      contentType,
      contentLength,
      contentRange,
      error: null,
    };
  } catch (e) {
    // Fallback: request only the first chunk.
    try {
      const rangeRes = await fetch(url, {
        ...commonInit,
        method: 'GET',
        headers: {
          ...(commonInit.headers as Record<string, string>),
          Range: 'bytes=0-1023',
        },
      });

      // Consume a small amount to avoid leaking resources.
      try {
        if (rangeRes.body) {
          const reader = rangeRes.body.getReader();
          await reader.read();
          try { await reader.cancel(); } catch { /* ignore */ }
        } else {
          // As a fallback, consume text (should be small when Range is honored)
          await rangeRes.text();
        }
      } catch {
        // ignore body consumption errors
      }

      return {
        attemptedUrl: url,
        method: 'GET_RANGE',
        status: rangeRes.status,
        ok: rangeRes.ok,
        contentType: rangeRes.headers.get('content-type'),
        contentLength: rangeRes.headers.get('content-length'),
        contentRange: rangeRes.headers.get('content-range'),
        error: null,
      };
    } catch (e2) {
      const msg = (e2 instanceof Error ? e2.message : String(e2)) || (e instanceof Error ? e.message : String(e));
      return {
        attemptedUrl: url,
        method: 'GET_RANGE',
        status: null,
        ok: false,
        contentType: null,
        contentLength: null,
        contentRange: null,
        error: msg,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const now = new Date().toISOString();

  try {
    const body = await safeJson(req);
    const currentYear = new Date().getFullYear();

    const year = typeof body.year === 'number' ? body.year : currentYear - 1;
    const variable = (body.variable === 'min' || body.variable === 'max' || body.variable === 'mean')
      ? (body.variable as 'mean' | 'max' | 'min')
      : 'mean';

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? null;
    const projectRef = getProjectRefFromSupabaseUrl(supabaseUrl);
    const dwdSourceUrl = buildDwdUrl(year, variable);

    const authHeader = req.headers.get('authorization');
    const apiKeyHeader = req.headers.get('apikey');

    const probe = await probeDwdUrl(dwdSourceUrl);

    // Helpful hint bucket
    let hint: string | null = null;
    if (probe.error) {
      hint = 'Upstream fetch failed (network/timeout).';
    } else if (probe.status === 404) {
      hint = 'DWD returned 404 (no data for that year/variable or URL changed).';
    } else if (probe.status === 401 || probe.status === 403) {
      hint = 'Upstream denied the request (unexpected for DWD open data).';
    } else if (probe.status && probe.status >= 500) {
      hint = 'DWD server error.';
    }

    return jsonResponse({
      ok: probe.ok,
      function: FUNCTION_NAME,
      projectRef,
      supabaseUrl,
      edgeFunctionUrl: supabaseUrl ? `${supabaseUrl}/functions/v1/${FUNCTION_NAME}` : null,
      lastFetchAttemptAt: now,
      lastFetchStatus: probe.status,
      sourceUrl: dwdSourceUrl,
      probe,
      request: {
        hasAuthorization: !!authHeader,
        hasApikey: !!apiKeyHeader,
      },
      error: probe.ok ? null : (probe.error ?? `Upstream returned HTTP ${probe.status}`),
      hint,
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      function: FUNCTION_NAME,
      lastFetchAttemptAt: now,
      error: err instanceof Error ? err.message : 'Unknown error',
      hint: 'Edge Function runtime error (check function logs).',
    }, 500);
  }
});
