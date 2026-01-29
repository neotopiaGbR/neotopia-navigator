/**
 * ecostress-latest-tile Edge Function
 * 
 * MULTI-SUMMER PARALLEL QUERY STRATEGY
 * 
 * Instead of one large temporal query (which returns winter data first due to -start_date sorting),
 * we make PARALLEL requests for each summer season (June-August) of the last 3 years.
 * 
 * This ensures we ONLY get heat-relevant data from actual summers.
 * 
 * Key improvements:
 * 1. Parallel CMR requests for 2023, 2024, 2025 summers
 * 2. Strict UTC time filter (10:00-15:00 UTC = 12:00-17:00 CEST peak heat)
 * 3. Quality scoring with coverage, cloud, and recency factors
 * 4. Returns top N granules merged from all summers
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  lat: number;
  lon: number;
  region_bbox?: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  min_quality_threshold?: number;
  max_granules?: number;
  mode?: 'historic_heat' | 'recent'; // historic_heat = 3-summer parallel, recent = last 60 days
}

// STRICT PEAK-HEAT FILTER: Only afternoon acquisitions
// Germany summer = UTC+2, so 12:00-17:00 local = 10:00-15:00 UTC
const UTC_HOUR_START = 10;
const UTC_HOUR_END = 15;

// OPTIMIZED STRATEGY:
// 1. Fetch 100 metadata entries per summer (3 years × 100 = 300 total) - fast!
// 2. Filter strictly: UTC 10-15 + cloud < 30%
// 3. Return only top 40 best granules for frontend processing
const CMR_PAGE_SIZE_PER_SUMMER = 100;
const MAX_CLOUD_COVER_PERCENT = 30;
const MAX_GRANULES_TO_RETURN = 40;

const ECOSTRESS_CONCEPT_ID = 'C2076090826-LPCLOUD';
const CMR_API_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json';
const DEFAULT_MIN_QUALITY = 0.10; // Lowered since we're pre-filtering strictly

interface CMRGranule {
  id: string;
  title: string;
  time_start: string;
  time_end: string;
  links: Array<{ href: string; rel: string; type?: string; title?: string }>;
  cloud_cover?: number;
  polygons?: string[][];
  boxes?: string[];
}

interface CMRResponse {
  feed: { entry: CMRGranule[] };
}

interface ScoredGranule extends CMRGranule {
  wgs84Bounds: [number, number, number, number];
  coverageRatio: number;
  cloudRatio: number;
  qualityScore: number;
  utcHour: number;
  summerYear: number;
}

interface SummerWindow {
  year: number;
  startDate: string;
  endDate: string;
}

/**
 * Generate summer time windows for the last N years
 */
function getSummerWindows(numYears: number = 3): SummerWindow[] {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 1-12
  const currentDay = new Date().getDate();
  
  const windows: SummerWindow[] = [];
  
  for (let i = 0; i < numYears; i++) {
    const year = currentYear - i;
    
    // For current year, only include if we're in or past June
    if (year === currentYear) {
      if (currentMonth >= 6) {
        // Current year summer: June 1 to today (or Aug 31 if past August)
        const endDate = currentMonth > 8 
          ? `${year}-08-31` 
          : `${year}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
        windows.push({
          year,
          startDate: `${year}-06-01`,
          endDate,
        });
      }
      // If before June, skip current year entirely
    } else {
      // Previous years: full June-August window
      windows.push({
        year,
        startDate: `${year}-06-01`,
        endDate: `${year}-08-31`,
      });
    }
  }
  
  return windows;
}

/**
 * Parse granule footprint from CMR response
 */
function parseGranuleBounds(granule: CMRGranule): [number, number, number, number] | null {
  if (granule.boxes && granule.boxes.length > 0) {
    const parts = granule.boxes[0].split(' ').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      return [parts[1], parts[0], parts[3], parts[2]];
    }
  }
  
  if (granule.polygons && granule.polygons.length > 0) {
    const ring = granule.polygons[0][0];
    const coords = ring.split(' ').map(Number);
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (let i = 0; i < coords.length - 1; i += 2) {
      const lat = coords[i];
      const lon = coords[i + 1];
      if (!isNaN(lat) && !isNaN(lon)) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
      }
    }
    if (minLon !== Infinity) {
      return [minLon, minLat, maxLon, maxLat];
    }
  }
  
  return null;
}

/**
 * Check if point is inside bounding box
 */
function pointInBbox(lon: number, lat: number, bbox: [number, number, number, number]): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

/**
 * Check if two bboxes intersect
 */
function bboxIntersects(
  bbox1: [number, number, number, number],
  bbox2: [number, number, number, number]
): boolean {
  return !(
    bbox1[2] < bbox2[0] ||
    bbox1[0] > bbox2[2] ||
    bbox1[3] < bbox2[1] ||
    bbox1[1] > bbox2[3]
  );
}

/**
 * Calculate intersection area ratio
 */
function calculateCoverageRatio(
  granuleBbox: [number, number, number, number],
  regionBbox: [number, number, number, number]
): number {
  const [g0, g1, g2, g3] = granuleBbox;
  const [r0, r1, r2, r3] = regionBbox;
  
  const intMinLon = Math.max(g0, r0);
  const intMinLat = Math.max(g1, r1);
  const intMaxLon = Math.min(g2, r2);
  const intMaxLat = Math.min(g3, r3);
  
  if (intMinLon >= intMaxLon || intMinLat >= intMaxLat) return 0;
  
  const intersectionArea = (intMaxLon - intMinLon) * (intMaxLat - intMinLat);
  const regionArea = (r2 - r0) * (r3 - r1);
  
  return regionArea === 0 ? 0 : Math.min(1.0, intersectionArea / regionArea);
}

/**
 * Find COG URL from granule links
 */
function findCogUrl(granule: CMRGranule): { lstUrl: string | null; cloudMaskUrl: string | null } {
  const dataLinks = granule.links.filter(
    (link) => link.rel === 'http://esipfed.org/ns/fedsearch/1.1/data#' || link.href.includes('.tif')
  );

  const lstLink = dataLinks.find((l) => {
    const href = l.href.toLowerCase();
    const isLstFile = href.endsWith('_lst.tif') || href.includes('_lst_');
    const isAuxFile = href.includes('_water') || href.includes('_cloud') || 
                      href.includes('_qc') || href.includes('_emis');
    return isLstFile && !isAuxFile;
  });

  const fallbackLstLink = !lstLink ? dataLinks.find((l) => {
    const href = l.href.toLowerCase();
    return href.includes('lste') && href.endsWith('.tif') && !href.includes('_emis');
  }) : null;

  const finalLstLink = lstLink || fallbackLstLink;
  const cloudMaskLink = dataLinks.find((l) => l.href.includes('QC') || l.href.includes('cloud'));

  const lstUrl = finalLstLink?.href || 
    `https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/ECO_L2T_LSTE.002/${granule.id}/${granule.id}_LST.tif`;

  return { lstUrl, cloudMaskUrl: cloudMaskLink?.href || null };
}

/**
 * Fetch granules for a single summer window
 */
async function fetchSummerGranules(
  window: SummerWindow,
  regionBbox: [number, number, number, number]
): Promise<{ granules: CMRGranule[]; stats: { total: number; timeFiltered: number; cloudFiltered: number } }> {
  const searchBbox = `${regionBbox[0]},${regionBbox[1]},${regionBbox[2]},${regionBbox[3]}`;
  
  const cmrParams = new URLSearchParams({
    concept_id: ECOSTRESS_CONCEPT_ID,
    bounding_box: searchBbox,
    temporal: `${window.startDate}T00:00:00Z,${window.endDate}T23:59:59Z`,
    sort_key: '-start_date',
    page_size: String(CMR_PAGE_SIZE_PER_SUMMER),
  });

  console.log(`[ECOSTRESS] Fetching summer ${window.year}: ${window.startDate} to ${window.endDate} (page_size: ${CMR_PAGE_SIZE_PER_SUMMER})`);

  try {
    const response = await fetch(`${CMR_API_URL}?${cmrParams}`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error(`[ECOSTRESS] CMR error for ${window.year}:`, response.status);
      return { granules: [], stats: { total: 0, timeFiltered: 0, cloudFiltered: 0 } };
    }

    const data = await response.json() as CMRResponse;
    const allGranules = data.feed?.entry || [];
    
    // FILTER 1: Strict UTC time (10:00-15:00 UTC = 12:00-17:00 CEST peak heat)
    const peakHeatGranules = allGranules.filter(g => {
      const acquisitionTime = new Date(g.time_start);
      const utcHour = acquisitionTime.getUTCHours();
      return utcHour >= UTC_HOUR_START && utcHour < UTC_HOUR_END;
    });
    
    const timeFiltered = allGranules.length - peakHeatGranules.length;
    
    // FILTER 2: Cloud cover < 30% (if available)
    const lowCloudGranules = peakHeatGranules.filter(g => {
      const cloudCover = g.cloud_cover ?? 0; // Default to 0 if not available
      return cloudCover < MAX_CLOUD_COVER_PERCENT;
    });
    
    const cloudFiltered = peakHeatGranules.length - lowCloudGranules.length;

    console.log(`[ECOSTRESS] Summer ${window.year}: ${allGranules.length} total → ${peakHeatGranules.length} peak-heat → ${lowCloudGranules.length} low-cloud (<${MAX_CLOUD_COVER_PERCENT}%)`);

    return { 
      granules: lowCloudGranules, 
      stats: { 
        total: allGranules.length, 
        timeFiltered,
        cloudFiltered
      } 
    };
  } catch (err) {
    console.error(`[ECOSTRESS] Fetch error for ${window.year}:`, err);
    return { granules: [], stats: { total: 0, timeFiltered: 0, cloudFiltered: 0 } };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as RequestBody;
    const { lat, lon, region_bbox, min_quality_threshold, max_granules, mode } = body;

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return new Response(
        JSON.stringify({ status: 'error', error: 'lat and lon are required numbers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const minQuality = min_quality_threshold ?? DEFAULT_MIN_QUALITY;
    const maxGranulesToReturn = max_granules ?? MAX_GRANULES_TO_RETURN;

    // Build region bbox if not provided
    const regionBbox: [number, number, number, number] = region_bbox || [
      lon - 0.005, lat - 0.005, lon + 0.005, lat + 0.005
    ];

    // Get summer windows (last 3 years)
    const summerWindows = getSummerWindows(3);
    
    console.log('[ECOSTRESS] OPTIMIZED MULTI-SUMMER QUERY');
    console.log('[ECOSTRESS] Strategy: Fetch 100/summer → Filter (UTC 10-15, cloud <30%) → Return top 40');
    console.log('[ECOSTRESS] Region:', regionBbox);
    console.log('[ECOSTRESS] Summer windows:', summerWindows.map(w => `${w.year}: ${w.startDate} to ${w.endDate}`));

    // PARALLEL REQUESTS for each summer (100 metadata entries each = 300 total)
    const results = await Promise.all(
      summerWindows.map(window => fetchSummerGranules(window, regionBbox))
    );

    // Merge all granules with year annotation
    const allGranules: CMRGranule[] = [];
    let totalFromCMR = 0;
    let totalTimeFiltered = 0;
    let totalCloudFiltered = 0;
    
    results.forEach((result, idx) => {
      totalFromCMR += result.stats.total;
      totalTimeFiltered += result.stats.timeFiltered;
      totalCloudFiltered += result.stats.cloudFiltered;
      result.granules.forEach(g => {
        (g as any)._summerYear = summerWindows[idx].year;
        allGranules.push(g);
      });
    });

    console.log(`[ECOSTRESS] After filters: ${allGranules.length} quality granules from ${totalFromCMR} total`);
    console.log(`[ECOSTRESS] Discarded: ${totalTimeFiltered} wrong-time, ${totalCloudFiltered} cloudy`);

    if (allGranules.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'no_coverage',
          message: `Keine ECOSTRESS-Daten gefunden (Filter: UTC ${UTC_HOUR_START}:00-${UTC_HOUR_END}:00, Cloud <${MAX_CLOUD_COVER_PERCENT}%).`,
          summers_queried: summerWindows.map(w => w.year),
          total_checked: totalFromCMR,
          time_filtered: totalTimeFiltered,
          cloud_filtered: totalCloudFiltered,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Score and filter granules
    const scoredGranules: ScoredGranule[] = [];
    let skippedNoBounds = 0;
    let skippedNoIntersect = 0;

    for (const granule of allGranules) {
      const bounds = parseGranuleBounds(granule);
      if (!bounds) {
        skippedNoBounds++;
        continue;
      }

      const intersectsRegion = pointInBbox(lon, lat, bounds) || bboxIntersects(regionBbox, bounds);
      if (!intersectsRegion) {
        skippedNoIntersect++;
        continue;
      }

      const coverageRatio = calculateCoverageRatio(bounds, regionBbox);
      const cloudRatio = (granule.cloud_cover ?? 50) / 100;
      const acquisitionTime = new Date(granule.time_start);
      const utcHour = acquisitionTime.getUTCHours();

      // Quality score: coverage (40%) + low cloud (30%) + valid pixels estimate (30%)
      const estimatedValidRatio = coverageRatio * (1 - cloudRatio * 0.8);
      const qualityScore = 
        0.4 * coverageRatio +
        0.3 * (1 - cloudRatio) +
        0.3 * estimatedValidRatio;

      if (qualityScore >= minQuality) {
        scoredGranules.push({
          ...granule,
          wgs84Bounds: bounds,
          coverageRatio,
          cloudRatio,
          qualityScore,
          utcHour,
          summerYear: (granule as any)._summerYear,
        });
      }
    }

    // Sort by quality score (highest first)
    const sortedGranules = scoredGranules.sort((a, b) => b.qualityScore - a.qualityScore);
    const topGranules = sortedGranules.slice(0, maxGranulesToReturn);

    console.log(`[ECOSTRESS] Quality filter: ${scoredGranules.length} passed (min ${minQuality})`);
    console.log(`[ECOSTRESS] Returning top ${topGranules.length} granules`);

    if (topGranules.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'no_coverage',
          message: 'Keine Granules erfüllen die Qualitätsanforderungen.',
          candidates_checked: allGranules.length,
          skipped_no_bounds: skippedNoBounds,
          skipped_no_intersect: skippedNoIntersect,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build response
    const allGranulesData = topGranules.map(granule => {
      const { lstUrl, cloudMaskUrl } = findCogUrl(granule);
      return {
        cog_url: lstUrl,
        cloud_mask_url: cloudMaskUrl,
        datetime: granule.time_start,
        granule_id: granule.id,
        granule_bounds: granule.wgs84Bounds,
        quality_score: granule.qualityScore,
        coverage_percent: Math.round(granule.coverageRatio * 100),
        cloud_percent: Math.round(granule.cloudRatio * 100),
        utc_hour: granule.utcHour,
        summer_year: granule.summerYear,
      };
    });

    // Year distribution for debugging
    const yearDistribution: Record<number, number> = {};
    topGranules.forEach(g => {
      yearDistribution[g.summerYear] = (yearDistribution[g.summerYear] || 0) + 1;
    });

    const bestGranule = topGranules[0];
    const { lstUrl, cloudMaskUrl } = findCogUrl(bestGranule);

    return new Response(
      JSON.stringify({
        status: 'match',
        // Primary: all granules for composite
        all_granules: allGranulesData,
        granule_count: allGranulesData.length,
        total_available: scoredGranules.length,
        // Legacy: best single granule
        cog_url: lstUrl,
        cloud_mask_url: cloudMaskUrl,
        datetime: bestGranule.time_start,
        granule_id: bestGranule.id,
        granule_bounds: bestGranule.wgs84Bounds,
        region_centroid: { lat, lon },
        quality_score: bestGranule.qualityScore,
        // Debug stats
        summers_queried: summerWindows.map(w => w.year),
        year_distribution: yearDistribution,
        peak_heat_filter: `UTC ${UTC_HOUR_START}:00-${UTC_HOUR_END}:00`,
        cloud_filter: `<${MAX_CLOUD_COVER_PERCENT}%`,
        candidates_from_cmr: totalFromCMR,
        filtered_wrong_time: totalTimeFiltered,
        filtered_cloudy: totalCloudFiltered,
        skipped_no_bounds: skippedNoBounds,
        skipped_no_intersect: skippedNoIntersect,
        attribution: 'NASA LP DAAC / ECOSTRESS LST (Multi-Summer Peak-Heat Composite)',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[ECOSTRESS] Error:', err);
    return new Response(
      JSON.stringify({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unbekannter Fehler',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
