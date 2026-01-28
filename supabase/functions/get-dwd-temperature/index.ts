/**
 * Supabase Edge Function: get-dwd-temperature
 *
 * Purpose
 * - Fetch HYRAS-DE seasonal (JJA) air temperature grids (ESRI ASCII Grid .asc.gz) from DWD OpenData
 * - Parse + convert to WGS84 point grid for client-side rendering (deck.gl)
 *
 * Fix implemented
 * - Robust CRS detection: EPSG:3035 vs UTM32/33 vs Gauss-Krüger (31467/31468)
 * - Uses BOTH raw-coordinate range heuristics AND Germany-bbox overlap scoring
 * - Prevents "Greenland bounds" / projection mismatch by choosing the best CRS candidate
 *
 * Germany plausibility bbox (intentionally generous)
 *   lon: 2 … 20
 *   lat: 44 … 58
 */

import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";
import proj4 from "https://esm.sh/proj4@2.12.1";

const proj4Any = proj4 as unknown as any;

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

// --- Projections ---
// EPSG:3035 ETRS89 / LAEA Europe
proj4Any.defs(
  "EPSG:3035",
  "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs",
);

// EPSG:25832/25833 ETRS89 / UTM
proj4Any.defs(
  "EPSG:25832",
  "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs",
);
proj4Any.defs(
  "EPSG:25833",
  "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs",
);

// EPSG:31467/31468 DHDN / Gauss-Krüger (still used in some German gridded products)
proj4Any.defs(
  "EPSG:31467",
  "+proj=tmerc +lat_0=0 +lon_0=9 +k=1 +x_0=3500000 +y_0=0 +ellps=bessel +units=m +no_defs",
);
proj4Any.defs(
  "EPSG:31468",
  "+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel +units=m +no_defs",
);

type SourceCrs = "EPSG:3035" | "EPSG:25832" | "EPSG:25833" | "EPSG:31467" | "EPSG:31468";

const CRS_CANDIDATES: SourceCrs[] = [
  "EPSG:3035",
  "EPSG:25832",
  "EPSG:25833",
  "EPSG:31467",
  "EPSG:31468",
];

// Generous Germany bbox for plausibility checks
const GER_BBOX = { minLon: 2.0, minLat: 44.0, maxLon: 20.0, maxLat: 58.0 };

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
  sample?: number; // sample every Nth cell
}

function projectToWgs84(crs: SourceCrs, x: number, y: number): { lon: number; lat: number } {
  const [lon, lat] = proj4Any(crs, "EPSG:4326", [x, y]) as [number, number];
  return { lon, lat };
}

function finiteBounds(b: [number, number, number, number]): boolean {
  return b.every((v) => Number.isFinite(v));
}

function intersectsGermanyBox(b: [number, number, number, number]): boolean {
  const [minLon, minLat, maxLon, maxLat] = b;
  if (!finiteBounds(b)) return false;
  // basic sanity
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return false;
  // intersection test
  const inter =
    !(maxLon < GER_BBOX.minLon ||
      minLon > GER_BBOX.maxLon ||
      maxLat < GER_BBOX.minLat ||
      minLat > GER_BBOX.maxLat);
  return inter;
}

function overlapScore(b: [number, number, number, number]): number {
  if (!intersectsGermanyBox(b)) return 0;

  const [minLon, minLat, maxLon, maxLat] = b;
  const iMinLon = Math.max(minLon, GER_BBOX.minLon);
  const iMinLat = Math.max(minLat, GER_BBOX.minLat);
  const iMaxLon = Math.min(maxLon, GER_BBOX.maxLon);
  const iMaxLat = Math.min(maxLat, GER_BBOX.maxLat);

  const interW = Math.max(0, iMaxLon - iMinLon);
  const interH = Math.max(0, iMaxLat - iMinLat);
  const interArea = interW * interH;

  const bboxW = GER_BBOX.maxLon - GER_BBOX.minLon;
  const bboxH = GER_BBOX.maxLat - GER_BBOX.minLat;
  const bboxArea = bboxW * bboxH;

  // 0..1: how much of Germany box is covered
  return interArea / bboxArea;
}

/**
 * Raw-coordinate plausibility filter.
 * This prevents trying projections that are obviously incompatible with the numeric ranges.
 */
function rawRangeLikely(crs: SourceCrs, x: number, y: number): boolean {
  // Using VERY generous ranges (meters)
  // - 3035: x/y typically ~2e6..6e6
  // - UTM:  x ~1e5..9e5, y ~4e6..7e6
  // - GK:   easting ~2.5e6..5.5e6, northing ~4.5e6..6.5e6
  switch (crs) {
    case "EPSG:3035":
      return x > 500_000 && x < 7_500_000 && y > 500_000 && y < 7_500_000;
    case "EPSG:25832":
    case "EPSG:25833":
      return x > 50_000 && x < 950_000 && y > 3_500_000 && y < 7_500_000;
    case "EPSG:31467":
    case "EPSG:31468":
      return x > 2_000_000 && x < 6_000_000 && y > 3_500_000 && y < 7_500_000;
    default:
      return true;
  }
}

/**
 * Parse ESRI ASCII Grid
 */
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
    console.warn(
      `[DWD] Parsed rows mismatch: expected ${md.nrows}, got ${data.length}`,
    );
  }

  return { metadata: md as GridMetadata, data };
}

/**
 * Detect CRS robustly by scoring candidates using:
 * - raw range plausibility
 * - Germany bbox overlap after projecting corners
 * - sample-point plausibility (center-ish point)
 */
function detectSourceCrs(metadata: GridMetadata): {
  sourceCrs: SourceCrs;
  bounds: [number, number, number, number];
  debug: any;
} {
  const xMin = metadata.xllcorner;
  const yMin = metadata.yllcorner;
  const xMax = metadata.xllcorner + metadata.ncols * metadata.cellsize;
  const yMax = metadata.yllcorner + metadata.nrows * metadata.cellsize;

  const corners: Array<[number, number]> = [
    [xMin, yMin],
    [xMin, yMax],
    [xMax, yMin],
    [xMax, yMax],
  ];

  // also test a "sample" point (roughly center of grid)
  const xMid = metadata.xllcorner + (metadata.ncols * metadata.cellsize) / 2;
  const yMid = metadata.yllcorner + (metadata.nrows * metadata.cellsize) / 2;

  const tried: any[] = [];
  let best: { crs: SourceCrs; bounds: [number, number, number, number]; score: number } | null = null;

  for (const crs of CRS_CANDIDATES) {
    // quick raw plausibility gate
    if (!rawRangeLikely(crs, xMin, yMin) || !rawRangeLikely(crs, xMax, yMax)) {
      tried.push({ crs, skipped: "raw-range" });
      continue;
    }

    try {
      const pts = corners.map(([x, y]) => projectToWgs84(crs, x, y));
      const lons = pts.map((p) => p.lon);
      const lats = pts.map((p) => p.lat);

      const bounds: [number, number, number, number] = [
        Math.min(...lons),
        Math.min(...lats),
        Math.max(...lons),
        Math.max(...lats),
      ];

      const s = overlapScore(bounds);

      // sample point plausibility
      const mid = projectToWgs84(crs, xMid, yMid);
      const midOk =
        mid.lon >= GER_BBOX.minLon - 10 &&
        mid.lon <= GER_BBOX.maxLon + 10 &&
        mid.lat >= GER_BBOX.minLat - 10 &&
        mid.lat <= GER_BBOX.maxLat + 10;

      // boost score if mid looks plausible
      const score = s + (midOk ? 0.25 : 0);

      tried.push({ crs, bounds, overlap: s, mid, score });

      if (!best || score > best.score) {
        best = { crs, bounds, score };
      }
    } catch (e) {
      tried.push({ crs, error: String(e) });
    }
  }

  if (best && best.score > 0.05) {
    return { sourceCrs: best.crs, bounds: best.bounds, debug: { tried, chosen: best } };
  }

  // fallback to 3035 but keep computed bounds for transparency
  try {
    const pts = corners.map(([x, y]) => projectToWgs84("EPSG:3035", x, y));
    const bounds: [number, number, number, number] = [
      Math.min(...pts.map((p) => p.lon)),
      Math.min(...pts.map((p) => p.lat)),
      Math.max(...pts.map((p) => p.lon)),
      Math.max(...pts.map((p) => p.lat)),
    ];
    return { sourceCrs: "EPSG:3035", bounds, debug: { tried, chosen: "fallback-3035" } };
  } catch {
    return {
      sourceCrs: "EPSG:3035",
      bounds: [0, 0, 0, 0],
      debug: { tried, chosen: "fallback-3035-no-bounds" },
    };
  }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body: RequestBody = await req.json().catch(() => ({}));

    const nowYear = new Date().getFullYear();
    const year = body.year ?? (nowYear - 1);
    const variable = body.variable ?? "mean";
    const sampleStep = Math.max(1, Math.floor(body.sample ?? 3));

    const url = buildDwdUrl(year, variable);
    console.log(`[DWD] Fetch ${variable} JJA ${year} sample=${sampleStep}`);
    console.log(`[DWD] URL: ${url}`);

    const resp = await fetch(url, { headers: { "User-Agent": "Neotopia Navigator / DWD Data Access" } });
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
    console.log(`[DWD] Grid ${metadata.ncols}x${metadata.nrows} cell=${metadata.cellsize}m nodata=${metadata.nodata_value}`);

    const det = detectSourceCrs(metadata);
    const sourceCrs = det.sourceCrs;
    const bounds = det.bounds;

    console.log(`[DWD] CRS chosen: ${sourceCrs} bounds=${JSON.stringify(bounds)}`);

    // HARD FAIL only if bounds are obviously insane (e.g. Greenland) AND do not intersect Germany bbox
    if (!intersectsGermanyBox(bounds)) {
      const sample = (() => {
        const x = metadata.xllcorner + metadata.cellsize * 10;
        const y = metadata.yllcorner + metadata.cellsize * 10;
        try {
          return projectToWgs84(sourceCrs, x, y);
        } catch {
          return { lon: NaN, lat: NaN };
        }
      })();

      throw new Error(
        `DWD data returned implausible coordinates (projection mismatch). bounds=${JSON.stringify(bounds)} sample=${JSON.stringify(sample)} debug=${JSON.stringify(det.debug)}`,
      );
    }

    // Convert to sampled cells
    const values: number[] = [];
    const grid: Array<{ lat: number; lon: number; value: number }> = [];

    for (let row = 0; row < data.length; row += sampleStep) {
      const r = data[row];
      if (!r) continue;

      for (let col = 0; col < r.length; col += sampleStep) {
        const raw = r[col];
        if (raw === metadata.nodata_value || raw <= -999) continue;

        // DWD uses 0.1°C
        const temp = raw / 10;

        // ESRI ASCII: row0 is north-most; compute from top
        const x = metadata.xllcorner + (col + 0.5) * metadata.cellsize;
        const y = metadata.yllcorner + ((data.length - 1 - row) + 0.5) * metadata.cellsize;

        const p = projectToWgs84(sourceCrs, x, y);
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;

        // keep only "reasonable Europe" points to avoid poisoning rendering
        if (p.lon < -30 || p.lon > 40 || p.lat < 35 || p.lat > 65) continue;

        grid.push({ lat: p.lat, lon: p.lon, value: Math.round(temp * 10) / 10 });
        values.push(temp);
      }
    }

    values.sort((a, b) => a - b);
    const min = values[0] ?? 0;
    const max = values[values.length - 1] ?? 0;
    const p5 = quantile(values, 0.05);
    const p95 = quantile(values, 0.95);

    return new Response(
      JSON.stringify({
        status: "ok",
        data: {
          grid,
          bounds,
          year,
          variable,
          season: "JJA",
          period: `${year}-06-01 to ${year}-08-31`,
          resolution_km: 1,
          cellsize_m: metadata.cellsize * sampleStep,
          crs_used: sourceCrs,
          normalization: {
            min: Math.round(min * 10) / 10,
            max: Math.round(max * 10) / 10,
            p5: Math.round(p5 * 10) / 10,
            p95: Math.round(p95 * 10) / 10,
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
