/**
 * Supabase Edge Function: get-dwd-temperature
 *
 * RESET VERSION - Forces EPSG:3035 only, no CRS auto-detection.
 * 
 * Purpose:
 * - Fetch HYRAS-DE seasonal (JJA) air temperature grids from DWD OpenData
 * - Parse ESRI ASCII Grid (.asc.gz)
 * - Transform from EPSG:3035 (LAEA Europe) to WGS84
 * - Return sampled grid for deck.gl rendering
 *
 * CRITICAL: EPSG:3035 is the ONLY supported CRS for HYRAS-DE seasonal grids.
 * Auto-detection was causing projection mismatches (Greenland coordinates).
 */

import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";
import proj4 from "https://esm.sh/proj4@2.12.1";

const proj4Any = proj4 as unknown as {
  defs: (name: string, def: string) => void;
  (from: string, to: string, coord: [number, number]): [number, number];
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, range, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers":
    "Content-Range, Accept-Ranges, Content-Length, Content-Type",
};

const DWD_BASE_URL =
  "https://opendata.dwd.de/climate_environment/CDC/grids_germany/seasonal";

const VARIABLE_PATHS: Record<string, string> = {
  mean: "air_temperature_mean/14_JJA",
  max: "air_temperature_max/14_JJA",
  min: "air_temperature_min/14_JJA",
};

// ═══════════════════════════════════════════════════════════════════════════
// EPSG:3035 - THE ONLY CRS WE USE
// ═══════════════════════════════════════════════════════════════════════════
proj4Any.defs(
  "EPSG:3035",
  "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs",
);

// Germany plausibility bbox (WGS84) - generous but realistic
const GERMANY_BBOX = {
  minLon: 4.0,
  maxLon: 16.0,
  minLat: 47.0,
  maxLat: 56.0,
};

interface GridMetadata {
  ncols: number;
  nrows: number;
  xllcorner: number;
  yllcorner: number;
  cellsize: number;
  nodata_value: number;
}

interface RequestBody {
  year?: number;
  variable?: "mean" | "max" | "min";
  sample?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTION: EPSG:3035 → WGS84
// ═══════════════════════════════════════════════════════════════════════════
function projectToWgs84(x: number, y: number): { lon: number; lat: number } {
  const [lon, lat] = proj4Any("EPSG:3035", "EPSG:4326", [x, y]);
  return { lon, lat };
}

function isWithinGermany(lon: number, lat: number): boolean {
  return (
    lon >= GERMANY_BBOX.minLon &&
    lon <= GERMANY_BBOX.maxLon &&
    lat >= GERMANY_BBOX.minLat &&
    lat <= GERMANY_BBOX.maxLat
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSE ESRI ASCII GRID
// ═══════════════════════════════════════════════════════════════════════════
function parseAsciiGrid(text: string): { metadata: GridMetadata; data: number[][] } {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  const md: Partial<GridMetadata> = {};
  let dataStart = 0;

  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i].trim();
    const parts = line.split(/\s+/);
    if (parts.length !== 2) {
      dataStart = i;
      break;
    }
    const key = parts[0].toLowerCase();
    const val = Number(parts[1]);
    if (!Number.isFinite(val)) {
      dataStart = i;
      break;
    }
    if (key === "ncols") md.ncols = Math.round(val);
    else if (key === "nrows") md.nrows = Math.round(val);
    else if (key === "xllcorner") md.xllcorner = val;
    else if (key === "yllcorner") md.yllcorner = val;
    else if (key === "cellsize") md.cellsize = val;
    else if (key === "nodata_value") md.nodata_value = val;
    else {
      dataStart = i;
      break;
    }
    dataStart = i + 1;
  }

  if (
    !md.ncols ||
    !md.nrows ||
    md.xllcorner === undefined ||
    md.yllcorner === undefined ||
    !md.cellsize
  ) {
    throw new Error("Invalid ASCII Grid: missing required header fields");
  }
  md.nodata_value = md.nodata_value ?? -9999;

  const data: number[][] = [];
  for (let i = dataStart; i < lines.length && data.length < md.nrows; i++) {
    const row = lines[i].trim().split(/\s+/).map((v) => Number(v));
    if (row.length === md.ncols) data.push(row);
  }

  if (data.length !== md.nrows) {
    console.warn(`[DWD] Parsed rows mismatch: expected ${md.nrows}, got ${data.length}`);
  }

  return { metadata: md as GridMetadata, data };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPUTE BOUNDS AND VALIDATE
// ═══════════════════════════════════════════════════════════════════════════
function computeAndValidateBounds(metadata: GridMetadata): {
  bounds: [number, number, number, number];
  valid: boolean;
  debug: Record<string, unknown>;
} {
  const xMin = metadata.xllcorner;
  const yMin = metadata.yllcorner;
  const xMax = metadata.xllcorner + metadata.ncols * metadata.cellsize;
  const yMax = metadata.yllcorner + metadata.nrows * metadata.cellsize;

  // Project all four corners
  const sw = projectToWgs84(xMin, yMin);
  const se = projectToWgs84(xMax, yMin);
  const nw = projectToWgs84(xMin, yMax);
  const ne = projectToWgs84(xMax, yMax);

  const bounds: [number, number, number, number] = [
    Math.min(sw.lon, se.lon, nw.lon, ne.lon),
    Math.min(sw.lat, se.lat, nw.lat, ne.lat),
    Math.max(sw.lon, se.lon, nw.lon, ne.lon),
    Math.max(sw.lat, se.lat, nw.lat, ne.lat),
  ];

  // Validate bounds are within Germany
  const valid =
    bounds[0] >= GERMANY_BBOX.minLon - 2 &&
    bounds[2] <= GERMANY_BBOX.maxLon + 2 &&
    bounds[1] >= GERMANY_BBOX.minLat - 2 &&
    bounds[3] <= GERMANY_BBOX.maxLat + 2;

  return {
    bounds,
    valid,
    debug: {
      raw3035: { xMin, yMin, xMax, yMax },
      corners: { sw, se, nw, ne },
      bounds,
      germanyBbox: GERMANY_BBOX,
    },
  };
}

function buildDwdUrl(year: number, variable: "mean" | "max" | "min"): string {
  const path = VARIABLE_PATHS[variable];
  const varPart = variable === "mean" ? "mean" : variable === "max" ? "max" : "min";
  const filename = `grids_germany_seasonal_air_temp_${varPart}_${year}14.asc.gz`;
  return `${DWD_BASE_URL}/${path}/${filename}`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
  return sorted[idx];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json().catch(() => ({}));

    const nowYear = new Date().getFullYear();
    const year = body.year ?? (nowYear - 1);
    const variable = body.variable ?? "mean";
    const sampleStep = Math.max(1, Math.floor(body.sample ?? 3));

    const url = buildDwdUrl(year, variable);
    console.log(`[DWD] Fetch ${variable} JJA ${year} sample=${sampleStep}`);
    console.log(`[DWD] URL: ${url}`);

    const resp = await fetch(url, {
      headers: { "User-Agent": "Neotopia Navigator / DWD Data Access" },
    });

    if (!resp.ok) {
      if (resp.status === 404) {
        return new Response(
          JSON.stringify({
            status: "no_data",
            message: `Keine Daten verfügbar für Sommer ${year}`,
            attribution: "Deutscher Wetterdienst (DWD), HYRAS-DE, CC BY 4.0",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`DWD fetch failed: ${resp.status} ${resp.statusText}`);
    }

    const gz = new Uint8Array(await resp.arrayBuffer());
    const dec = gunzip(gz);
    const text = new TextDecoder().decode(dec);

    const { metadata, data } = parseAsciiGrid(text);
    console.log(
      `[DWD] Grid ${metadata.ncols}x${metadata.nrows} cell=${metadata.cellsize}m nodata=${metadata.nodata_value}`,
    );

    // Compute bounds with EPSG:3035 only
    const boundsResult = computeAndValidateBounds(metadata);
    console.log(`[DWD] Bounds: ${JSON.stringify(boundsResult.bounds)}`);
    console.log(`[DWD] Valid for Germany: ${boundsResult.valid}`);

    if (!boundsResult.valid) {
      throw new Error(
        `DWD data has invalid bounds (not within Germany). bounds=${JSON.stringify(boundsResult.bounds)} debug=${JSON.stringify(boundsResult.debug)}`,
      );
    }

    // Convert to sampled grid cells
    const values: number[] = [];
    const grid: Array<{
      lat: number;
      lon: number;
      x3035: number;
      y3035: number;
      value: number;
    }> = [];

    for (let row = 0; row < data.length; row += sampleStep) {
      const r = data[row];
      if (!r) continue;

      for (let col = 0; col < r.length; col += sampleStep) {
        const raw = r[col];
        if (raw === metadata.nodata_value || raw <= -999) continue;

        // DWD stores values in 0.1°C
        const temp = raw / 10;

        // ESRI ASCII: row0 is north-most; compute from top
        const x = metadata.xllcorner + (col + 0.5) * metadata.cellsize;
        const y = metadata.yllcorner + ((data.length - 1 - row) + 0.5) * metadata.cellsize;

        const p = projectToWgs84(x, y);
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;

        // Only include points within Germany bbox
        if (!isWithinGermany(p.lon, p.lat)) continue;

        grid.push({
          lat: p.lat,
          lon: p.lon,
          x3035: x,
          y3035: y,
          value: Math.round(temp * 10) / 10,
        });
        values.push(temp);
      }
    }

    if (values.length === 0) {
      return new Response(
        JSON.stringify({
          status: "no_data",
          message: `Keine gültigen Datenpunkte für Sommer ${year}`,
          attribution: "Deutscher Wetterdienst (DWD), HYRAS-DE, CC BY 4.0",
          debug: boundsResult.debug,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    values.sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    const p5 = quantile(values, 0.05);
    const p95 = quantile(values, 0.95);

    console.log(`[DWD] Grid points: ${grid.length}, temp range: ${min.toFixed(1)}–${max.toFixed(1)}°C`);

    return new Response(
      JSON.stringify({
        status: "ok",
        data: {
          grid,
          bounds: boundsResult.bounds,
          bounds_3035: [
            metadata.xllcorner,
            metadata.yllcorner,
            metadata.xllcorner + metadata.ncols * metadata.cellsize,
            metadata.yllcorner + metadata.nrows * metadata.cellsize,
          ],
          year,
          variable,
          season: "JJA",
          period: `${year}-06-01 to ${year}-08-31`,
          resolution_km: 1,
          cellsize_m: metadata.cellsize * sampleStep,
          crs: "EPSG:3035",
          pointCount: grid.length,
          normalization: {
            min: Math.round(min * 10) / 10,
            max: Math.round(max * 10) / 10,
            p5: Math.round(p5 * 10) / 10,
            p95: Math.round(p95 * 10) / 10,
          },
        },
        attribution: "Deutscher Wetterdienst (DWD), HYRAS-DE, CC BY 4.0",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[DWD] Error:", err);
    return new Response(
      JSON.stringify({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
