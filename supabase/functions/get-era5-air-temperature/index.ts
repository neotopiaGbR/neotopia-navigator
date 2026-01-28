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
    // We'll sample a subset of points for performance (every 3rd point = ~3x faster)
    const sampleStep = 3;
    const sampledPoints = gridPoints.filter((_, i) => i % sampleStep === 0);
    
    console.log(`[ERA5] Sampling ${sampledPoints.length} points`);

    // Fetch data in parallel batches
    const batchSize = 20;
    const results: GridPoint[] = [];
    
    for (let i = 0; i < sampledPoints.length; i += batchSize) {
      const batch = sampledPoints.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (point) => {
        try {
          const url = `https://archive-api.open-meteo.com/v1/archive?` +
            `latitude=${point.lat}&longitude=${point.lon}` +
            `&start_date=${year}-06-01&end_date=${year}-08-31` +
            `&daily=temperature_2m_max,temperature_2m_mean` +
            `&timezone=Europe/Berlin`;
          
          const response = await fetch(url);
          if (!response.ok) {
            console.warn(`[ERA5] Failed for ${point.lat},${point.lon}: ${response.status}`);
            return null;
          }
          
          const data = await response.json();
          
          if (!data.daily) {
            return null;
          }
          
          // Calculate summer mean of daily max or daily mean
          const values = aggregation === 'daily_max' 
            ? data.daily.temperature_2m_max 
            : data.daily.temperature_2m_mean;
          
          if (!values || values.length === 0) {
            return null;
          }
          
          // Filter out null values and calculate mean
          const validValues = values.filter((v: number | null) => v !== null) as number[];
          if (validValues.length === 0) {
            return null;
          }
          
          const meanValue = validValues.reduce((a: number, b: number) => a + b, 0) / validValues.length;
          
          return {
            lat: point.lat,
            lon: point.lon,
            value: Math.round(meanValue * 10) / 10, // Round to 1 decimal
          };
        } catch (err) {
          console.warn(`[ERA5] Error for ${point.lat},${point.lon}:`, err);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter((r): r is GridPoint => r !== null));
      
      // Progress log
      if (i % (batchSize * 5) === 0) {
        console.log(`[ERA5] Progress: ${i + batchSize}/${sampledPoints.length} points`);
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
