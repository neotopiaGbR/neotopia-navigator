/**
 * ERA5-Land Air Temperature Edge Function
 * 
 * Fetches 2m air temperature data from Open-Meteo ERA5-Land for Germany.
 * Returns summer composite (June-August) with daily max or mean aggregation.
 * 
 * Data source: Copernicus Climate Data Store via Open-Meteo
 * License: CC BY 4.0 (Copernicus Climate Change Service)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Deterministic PRNG (so sampling order is stable for a given year/aggregation)
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashToSeed(input: string): number {
  // Simple 32-bit hash
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

async function fetchJsonWithRetry(url: string, maxRetries = 3) {
  // Multi-location responses can be large; allow more time before aborting.
  const timeoutMs = 30_000;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        // Retry on rate limit / transient upstream errors
        const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
        if (retryable && attempt < maxRetries) {
          const backoff = 250 * Math.pow(2, attempt);
          await sleep(backoff);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const backoff = 250 * Math.pow(2, attempt);
        await sleep(backoff);
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastErr;
}

// Germany bounding box (approximate)
const GERMANY_BBOX = {
  minLon: 5.87,
  maxLon: 15.04,
  minLat: 47.27,
  maxLat: 55.06,
};

// Grid resolution for ERA5-Land (~9km = ~0.1 degrees)
const GRID_RESOLUTION = 0.1;

interface RequestBody {
  year?: number;
  aggregation?: 'daily_max' | 'daily_mean';
}

interface GridPoint {
  lat: number;
  lon: number;
  value: number; // Temperature in Celsius
}

interface ERA5Response {
  status: 'ok' | 'error' | 'no_data';
  data?: {
    grid: GridPoint[];
    bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
    year: number;
    aggregation: 'daily_max' | 'daily_mean';
    period: string;
    resolution_km: number;
    normalization: {
      p5: number;
      p95: number;
      min: number;
      max: number;
    };
  };
  attribution?: string;
  error?: string;
  message?: string;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json().catch(() => ({}));
    
    // Default to previous year for complete summer data
    const currentYear = new Date().getFullYear();
    const year = body.year || currentYear - 1;
    const aggregation = body.aggregation || 'daily_max';
    
    console.log(`[ERA5] Fetching ${aggregation} for Germany, summer ${year}`);

    // Generate grid points covering Germany
    const gridPoints: { lat: number; lon: number }[] = [];
    for (let lat = GERMANY_BBOX.minLat; lat <= GERMANY_BBOX.maxLat; lat += GRID_RESOLUTION) {
      for (let lon = GERMANY_BBOX.minLon; lon <= GERMANY_BBOX.maxLon; lon += GRID_RESOLUTION) {
        gridPoints.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
      }
    }

    console.log(`[ERA5] Grid points to fetch: ${gridPoints.length}`);

    // Batch fetch from Open-Meteo Archive API
    // We sample a subset for performance, but shuffle deterministically so partial
    // failures never bias coverage to one geography (e.g., missing the north).
    const sampleStep = 3;
    const sampledPoints = gridPoints.filter((_, i) => i % sampleStep === 0);

    // Deterministic shuffle by (year, aggregation)
    const rng = mulberry32(hashToSeed(`${year}-${aggregation}`));
    for (let i = sampledPoints.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = sampledPoints[i];
      sampledPoints[i] = sampledPoints[j];
      sampledPoints[j] = tmp;
    }

    console.log(`[ERA5] Sampling ${sampledPoints.length} points (step=${sampleStep})`);

    // Fetch data using Open-Meteo multi-location mode (comma-separated latitude/longitude lists)
    // This dramatically reduces request count and avoids rate-limit dropouts that were
    // disproportionately removing late-processed (northern) points.
    const chunkSize = 150;
    const results: GridPoint[] = [];

    for (let i = 0; i < sampledPoints.length; i += chunkSize) {
      const chunk = sampledPoints.slice(i, i + chunkSize);

      const latList = chunk.map((p) => p.lat).join(',');
      const lonList = chunk.map((p) => p.lon).join(',');

      const url = `https://archive-api.open-meteo.com/v1/archive?` +
        `latitude=${latList}&longitude=${lonList}` +
        `&start_date=${year}-06-01&end_date=${year}-08-31` +
        `&daily=temperature_2m_max,temperature_2m_mean` +
        `&timezone=Europe/Berlin`;

      try {
        const payload = await fetchJsonWithRetry(url, 3);
        const responses = Array.isArray(payload) ? payload : [payload];

        for (let idx = 0; idx < responses.length; idx++) {
          const r = responses[idx];
          const daily = r?.daily;
          if (!daily) continue;

          const values = aggregation === 'daily_max'
            ? daily.temperature_2m_max
            : daily.temperature_2m_mean;
          if (!values || values.length === 0) continue;

          const validValues = (values as Array<number | null>).filter((v) => v !== null) as number[];
          if (validValues.length === 0) continue;

          const meanValue = validValues.reduce((a, b) => a + b, 0) / validValues.length;

          // Prefer coordinates echoed by Open-Meteo, fallback to chunk ordering
          const lat = typeof r?.latitude === 'number' ? r.latitude : chunk[idx]?.lat;
          const lon = typeof r?.longitude === 'number' ? r.longitude : chunk[idx]?.lon;
          if (typeof lat !== 'number' || typeof lon !== 'number') continue;

          results.push({
            lat,
            lon,
            value: Math.round(meanValue * 10) / 10,
          });
        }
      } catch (err) {
        console.warn(`[ERA5] Chunk error (${i}-${i + chunk.length}):`, err instanceof Error ? err.message : err);
      }

      // Light throttling between chunks
      await sleep(100);

      if (i % (chunkSize * 5) === 0) {
        console.log(`[ERA5] Progress: ${Math.min(i + chunkSize, sampledPoints.length)}/${sampledPoints.length} points (chunks)`);
      }
    }

    console.log(`[ERA5] Successfully fetched ${results.length} points`);

    if (results.length === 0) {
      const response: ERA5Response = {
        status: 'no_data',
        message: 'Keine ERA5-Daten verfügbar für den angegebenen Zeitraum',
        attribution: 'Copernicus Climate Change Service (C3S)',
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate Germany-wide normalization (P5-P95)
    const allValues = results.map(r => r.value).sort((a, b) => a - b);
    const p5Index = Math.floor(allValues.length * 0.05);
    const p95Index = Math.floor(allValues.length * 0.95);
    
    const normalization = {
      p5: allValues[p5Index],
      p95: allValues[p95Index],
      min: allValues[0],
      max: allValues[allValues.length - 1],
    };

    console.log(`[ERA5] Normalization: P5=${normalization.p5}°C, P95=${normalization.p95}°C, range=${normalization.min}-${normalization.max}°C`);

    const response: ERA5Response = {
      status: 'ok',
      data: {
        grid: results,
        bounds: [GERMANY_BBOX.minLon, GERMANY_BBOX.minLat, GERMANY_BBOX.maxLon, GERMANY_BBOX.maxLat],
        year,
        aggregation,
        period: `${year}-06-01 to ${year}-08-31`,
        resolution_km: 9,
        normalization,
      },
      attribution: 'Copernicus Climate Change Service (C3S) / ERA5-Land',
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[ERA5] Error:', err);
    const response: ERA5Response = {
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
