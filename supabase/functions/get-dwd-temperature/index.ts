/**
 * DWD HYRAS-DE Air Temperature Edge Function
 * 
 * Fetches pre-aggregated seasonal (JJA = summer) air temperature data from
 * DWD Climate Data Center in ESRI ASCII Grid format, parses it, and returns
 * the grid data for client-side rendering.
 * 
 * Data source: DWD Climate Data Center (CDC)
 * Dataset: HYRAS-DE seasonal grids
 * Resolution: 1 km × 1 km
 * CRS: EPSG:3035 (LAEA Europe)
 * License: CC BY 4.0
 * 
 * The function returns a GeoJSON FeatureCollection or a simplified grid array
 * for efficient rendering with deck.gl GeoJsonLayer.
 */

 import { gunzip } from 'https://deno.land/x/compress@v0.4.5/mod.ts';
 import proj4 from 'https://esm.sh/proj4@2.12.1';

 // esm.sh typings may expose proj4 as a callable function without the `defs` helper.
 // Runtime still provides `defs`, so we keep this cast local and explicit.
 const proj4Any = proj4 as unknown as any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, range, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
};

// DWD CDC base URLs
const DWD_BASE_URL = 'https://opendata.dwd.de/climate_environment/CDC/grids_germany/seasonal';

// Variable mapping
const VARIABLE_PATHS: Record<string, string> = {
  'mean': 'air_temperature_mean/14_JJA',
  'max': 'air_temperature_max/14_JJA',
  'min': 'air_temperature_min/14_JJA',
};

// Define EPSG:3035 (ETRS89 / LAEA Europe) for accurate coordinate conversion.
// This replaces the previous approximation which could produce invalid lat/lon.
// Ref: https://epsg.io/3035
proj4Any.defs(
  'EPSG:3035',
  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs'
);

interface GridMetadata {
  ncols: number;
  nrows: number;
  xllcorner: number;
  yllcorner: number;
  cellsize: number;
  nodata_value: number;
}

interface GridCell {
  x: number; // EPSG:3035 x (meters)
  y: number; // EPSG:3035 y (meters)
  lat: number; // WGS84 latitude
  lon: number; // WGS84 longitude
  value: number; // Temperature in 0.1°C (raw) or °C (converted)
}

interface RequestBody {
  year?: number;
  variable?: 'mean' | 'max' | 'min';
  format?: 'grid' | 'geojson';
  sample?: number; // Sample every Nth cell for performance (default: 1 = all)
}

/**
 * Accurate EPSG:3035 (ETRS89 / LAEA Europe) → WGS84 (EPSG:4326)
 */
function epsg3035ToWgs84(x: number, y: number): { lat: number; lon: number } {
  // proj4 returns [lon, lat]
  const [lon, lat] = proj4Any('EPSG:3035', 'EPSG:4326', [x, y]) as [number, number];
  return { lat, lon };
}

/**
 * Parse ESRI ASCII Grid format
 */
function parseAsciiGrid(text: string): { metadata: GridMetadata; data: number[][] } {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  
  const metadata: Partial<GridMetadata> = {};
  let dataStartLine = 0;
  
  // Parse header
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim().toLowerCase();
    const parts = line.split(/\s+/);
    
    if (parts.length === 2) {
      const key = parts[0];
      const value = parseFloat(parts[1]);
      
      if (key === 'ncols') metadata.ncols = Math.round(value);
      else if (key === 'nrows') metadata.nrows = Math.round(value);
      else if (key === 'xllcorner') metadata.xllcorner = value;
      else if (key === 'yllcorner') metadata.yllcorner = value;
      else if (key === 'cellsize') metadata.cellsize = value;
      else if (key === 'nodata_value') metadata.nodata_value = value;
      else {
        // This line doesn't match header format, data starts here
        dataStartLine = i;
        break;
      }
      dataStartLine = i + 1;
    } else {
      dataStartLine = i;
      break;
    }
  }
  
  // Validate required fields
  if (!metadata.ncols || !metadata.nrows || metadata.xllcorner === undefined || 
      metadata.yllcorner === undefined || !metadata.cellsize) {
    throw new Error('Invalid ASCII Grid: missing required header fields');
  }
  
  // Default nodata if not specified
  metadata.nodata_value = metadata.nodata_value ?? -9999;
  
  // Parse data rows (from top to bottom in the file = north to south geographically)
  const data: number[][] = [];
  for (let i = dataStartLine; i < lines.length && data.length < metadata.nrows; i++) {
    const row = lines[i].trim().split(/\s+/).map(v => parseFloat(v));
    if (row.length === metadata.ncols) {
      data.push(row);
    } else if (row.length > 0 && row.length !== metadata.ncols) {
      // Handle case where row might span multiple lines
      console.warn(`Row ${i} has ${row.length} cols, expected ${metadata.ncols}`);
    }
  }
  
  return { metadata: metadata as GridMetadata, data };
}

/**
 * Convert grid to array of cells with coordinates
 */
function gridToCells(
  metadata: GridMetadata, 
  data: number[][], 
  sampleStep: number = 1
): { cells: GridCell[]; stats: { min: number; max: number; p5: number; p95: number; mean: number } } {
  const cells: GridCell[] = [];
  const validValues: number[] = [];
  
  const halfCell = metadata.cellsize / 2;
  
  for (let row = 0; row < data.length; row += sampleStep) {
    for (let col = 0; col < data[row].length; col += sampleStep) {
      const rawValue = data[row][col];
      
      // Skip nodata values
      if (rawValue === metadata.nodata_value || rawValue <= -999) {
        continue;
      }
      
      // DWD stores temperature in 0.1°C units
      const tempCelsius = rawValue / 10;
      
      // Calculate cell center coordinates in EPSG:3035
      // Row 0 is the NORTHERN edge, so we need to calculate from top
      const x = metadata.xllcorner + (col + 0.5) * metadata.cellsize;
      const y = metadata.yllcorner + ((data.length - 1 - row) + 0.5) * metadata.cellsize;
      
      // Transform to WGS84
      const { lat, lon } = epsg3035ToWgs84(x, y);
      
      cells.push({
        x,
        y,
        lat,
        lon,
        value: Math.round(tempCelsius * 10) / 10, // Round to 0.1°C
      });
      
      validValues.push(tempCelsius);
    }
  }
  
  // Calculate statistics
  validValues.sort((a, b) => a - b);
  const n = validValues.length;
  
  const stats = {
    min: validValues[0] ?? 0,
    max: validValues[n - 1] ?? 0,
    p5: validValues[Math.floor(n * 0.05)] ?? 0,
    p95: validValues[Math.floor(n * 0.95)] ?? 0,
    mean: n > 0 ? validValues.reduce((a, b) => a + b, 0) / n : 0,
  };
  
  return { cells, stats };
}

/**
 * Build DWD file URL for a given year and variable
 */
function buildDwdUrl(year: number, variable: string): string {
  const path = VARIABLE_PATHS[variable];
  if (!path) {
    throw new Error(`Unknown variable: ${variable}`);
  }
  
  // File naming: grids_germany_seasonal_air_temp_mean_YYYY14.asc.gz
  // Where YYYY is year and 14 = JJA season code
  const varPart = variable === 'mean' ? 'mean' : (variable === 'max' ? 'max' : 'min');
  const filename = `grids_germany_seasonal_air_temp_${varPart}_${year}14.asc.gz`;
  
  return `${DWD_BASE_URL}/${path}/${filename}`;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json().catch(() => ({}));
    
    // Default to previous year for complete summer data
    const currentYear = new Date().getFullYear();
    const year = body.year || currentYear - 1;
    const variable = body.variable || 'mean';
    const sampleStep = body.sample || 3; // Sample every 3rd cell by default for performance
    
    console.log(`[DWD] Fetching ${variable} temperature for summer ${year}, sample=${sampleStep}`);
    
    // Build URL and fetch
    const url = buildDwdUrl(year, variable);
    console.log(`[DWD] URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Neotopia Navigator / DWD Data Access',
      },
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return new Response(JSON.stringify({
          status: 'no_data',
          message: `Keine Daten verfügbar für Sommer ${year}`,
          attribution: 'Deutscher Wetterdienst (DWD)',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`DWD fetch failed: ${response.status} ${response.statusText}`);
    }
    
    // Download and decompress
    const gzippedData = new Uint8Array(await response.arrayBuffer());
    console.log(`[DWD] Downloaded ${gzippedData.length} bytes (gzipped)`);
    
    const decompressed = gunzip(gzippedData);
    const text = new TextDecoder().decode(decompressed);
    console.log(`[DWD] Decompressed to ${text.length} chars`);
    
    // Parse ASCII grid
    const { metadata, data } = parseAsciiGrid(text);
    console.log(`[DWD] Parsed grid: ${metadata.ncols}x${metadata.nrows}, cellsize=${metadata.cellsize}m`);
    
    // Convert to cells with sampling
    const { cells, stats } = gridToCells(metadata, data, sampleStep);
    console.log(`[DWD] Extracted ${cells.length} cells, temp range: ${stats.min.toFixed(1)}°C to ${stats.max.toFixed(1)}°C`);
    
    // Calculate bounds in WGS84
    const lons = cells.map(c => c.lon);
    const lats = cells.map(c => c.lat);
    const bounds: [number, number, number, number] = [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ];
    
    return new Response(JSON.stringify({
      status: 'ok',
      data: {
        grid: cells.map(c => ({ lat: c.lat, lon: c.lon, value: c.value })),
        bounds,
        year,
        variable,
        season: 'JJA',
        period: `${year}-06-01 to ${year}-08-31`,
        resolution_km: 1,
        cellsize_m: metadata.cellsize * sampleStep, // Effective resolution after sampling
        normalization: {
          p5: Math.round(stats.p5 * 10) / 10,
          p95: Math.round(stats.p95 * 10) / 10,
          min: Math.round(stats.min * 10) / 10,
          max: Math.round(stats.max * 10) / 10,
        },
        gridMetadata: {
          ncols: metadata.ncols,
          nrows: metadata.nrows,
          xllcorner: metadata.xllcorner,
          yllcorner: metadata.yllcorner,
          cellsize: metadata.cellsize,
          sampleStep,
        },
      },
      attribution: 'Deutscher Wetterdienst (DWD), HYRAS-DE, CC BY 4.0',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[DWD] Error:', err);
    return new Response(JSON.stringify({
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
