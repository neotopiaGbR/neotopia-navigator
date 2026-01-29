/**
 * ecostress-latest-tile Edge Function
 * 
 * Discovers NASA ECOSTRESS LST tiles that INTERSECT the selected region.
 * Uses quality-based scoring + daytime filtering + pagination for complete results.
 * Returns top N granules (by quality) for composite rendering.
 * 
 * Scoring formula:
 * score = 0.4 * coverage_ratio + 0.3 * valid_pixel_estimate + 0.2 * (1 - cloud_ratio) + 0.1 * recency
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
  date_from?: string;
  date_to?: string;
  min_quality_threshold?: number; // Minimum quality score (0-1), default 0.2
  daytime_only?: boolean; // Filter to daytime acquisitions only (default: true)
  max_granules?: number; // Cap on returned granules (default: 40)
}

// Daytime filter: Use approximate *solar local time* derived from longitude.
// solarLocalTime ≈ UTC + lon/15 (hours). This is more robust than filtering by UTC.
const DAYTIME_START_LOCAL = 9;
const DAYTIME_END_LOCAL = 17;

// Maximum granules to return - INCREASED for robust P90 statistics
// More granules = better differentiation between P90 and Max
const DEFAULT_MAX_GRANULES = 100;
// CMR page size (max 2000) - keep high to capture full summer
const CMR_PAGE_SIZE = 1000;
// Max pages to fetch (safety limit) - allows up to 5000 granules
const MAX_CMR_PAGES = 5;

function getSolarLocalHour(date: Date, lon: number): number {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return (utcHours + lon / 15 + 24) % 24;
}

interface CMRGranule {
  id: string;
  title: string;
  time_start: string;
  time_end: string;
  links: Array<{ href: string; rel: string; type?: string; title?: string }>;
  cloud_cover?: number;
  polygons?: string[][]; // CMR polygon footprints
  boxes?: string[]; // CMR bounding boxes "south west north east"
}

interface CMRResponse {
  feed: { 
    entry: CMRGranule[];
    // CMR returns total hits in headers, but we can infer from result count
  };
}

interface ScoredGranule extends CMRGranule {
  wgs84Bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  distanceToCentroid: number;
  intersectsRegion: boolean;
  coverageRatio: number; // 0-1: how much of region is covered
  cloudRatio: number; // 0-1: cloud cover percentage
  recencyScore: number; // 0-1: how recent (1 = today, 0 = oldest)
  qualityScore: number; // Combined weighted score
  solarLocalHour: number; // For debugging
}

const ECOSTRESS_CONCEPT_ID = 'C2076090826-LPCLOUD';
const CMR_API_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json';
const DEFAULT_MIN_QUALITY = 0.15;

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

/**
 * Parse granule footprint from CMR response
 */
function parseGranuleBounds(granule: CMRGranule): [number, number, number, number] | null {
  // Try CMR boxes first: "south west north east" format
  if (granule.boxes && granule.boxes.length > 0) {
    const parts = granule.boxes[0].split(' ').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      // CMR: south, west, north, east → [minLon, minLat, maxLon, maxLat]
      return [parts[1], parts[0], parts[3], parts[2]];
    }
  }
  
  // Try polygons: array of "lat lon lat lon..." strings
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
    bbox1[2] < bbox2[0] || // bbox1 is left of bbox2
    bbox1[0] > bbox2[2] || // bbox1 is right of bbox2
    bbox1[3] < bbox2[1] || // bbox1 is below bbox2
    bbox1[1] > bbox2[3]    // bbox1 is above bbox2
  );
}

/**
 * Calculate intersection area ratio (granule ∩ region / region area)
 */
function calculateCoverageRatio(
  granuleBbox: [number, number, number, number],
  regionBbox: [number, number, number, number]
): number {
  const [g0, g1, g2, g3] = granuleBbox;
  const [r0, r1, r2, r3] = regionBbox;
  
  // Calculate intersection
  const intMinLon = Math.max(g0, r0);
  const intMinLat = Math.max(g1, r1);
  const intMaxLon = Math.min(g2, r2);
  const intMaxLat = Math.min(g3, r3);
  
  // No intersection
  if (intMinLon >= intMaxLon || intMinLat >= intMaxLat) {
    return 0;
  }
  
  const intersectionArea = (intMaxLon - intMinLon) * (intMaxLat - intMinLat);
  const regionArea = (r2 - r0) * (r3 - r1);
  
  if (regionArea === 0) return 0;
  
  // Clamp to 1.0 (in case granule fully covers region)
  return Math.min(1.0, intersectionArea / regionArea);
}

/**
 * Calculate distance between point and bbox center (in km)
 */
function distanceToBboxCenter(
  lon: number, 
  lat: number, 
  bbox: [number, number, number, number]
): number {
  const centerLon = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  
  // Haversine distance
  const R = 6371;
  const dLat = (centerLat - lat) * Math.PI / 180;
  const dLon = (centerLon - lon) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat * Math.PI / 180) * Math.cos(centerLat * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Calculate quality score for a granule
 */
function calculateQualityScore(
  granuleBbox: [number, number, number, number],
  regionBbox: [number, number, number, number],
  cloudCover: number | undefined,
  acquisitionDate: Date,
  oldestDate: Date,
  newestDate: Date
): { score: number; coverageRatio: number; cloudRatio: number; recencyScore: number } {
  // Coverage ratio (0-1)
  const coverageRatio = calculateCoverageRatio(granuleBbox, regionBbox);
  
  // Cloud ratio (0-1, lower is better)
  const cloudRatio = (cloudCover ?? 50) / 100; // Default to 50% if unknown
  
  // Recency score (0-1, newer is better)
  const dateRange = newestDate.getTime() - oldestDate.getTime();
  const recencyScore = dateRange > 0 
    ? (acquisitionDate.getTime() - oldestDate.getTime()) / dateRange
    : 1;
  
  // Estimated valid pixel ratio based on coverage and cloud
  const estimatedValidRatio = coverageRatio * (1 - cloudRatio * 0.8);
  
  // Combined score with weights
  const score = 
    0.4 * coverageRatio +
    0.3 * estimatedValidRatio +
    0.2 * (1 - cloudRatio) +
    0.1 * recencyScore;
  
  return { score, coverageRatio, cloudRatio, recencyScore };
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
 * Fetch all pages from CMR (with pagination)
 */
async function fetchAllCMRGranules(
  regionBbox: [number, number, number, number],
  startDate: string,
  endDate: string
): Promise<CMRGranule[]> {
  const allGranules: CMRGranule[] = [];
  let page = 1;
  let hasMore = true;
  
  // Use region bbox directly for more precise search
  const searchBbox = `${regionBbox[0]},${regionBbox[1]},${regionBbox[2]},${regionBbox[3]}`;
  
  while (hasMore && page <= MAX_CMR_PAGES) {
    const cmrParams = new URLSearchParams({
      concept_id: ECOSTRESS_CONCEPT_ID,
      bounding_box: searchBbox,
      temporal: `${startDate}T00:00:00Z,${endDate}T23:59:59Z`,
      sort_key: '-start_date',
      page_size: String(CMR_PAGE_SIZE),
      page_num: String(page),
    });

    console.log(`[ECOSTRESS] Fetching CMR page ${page}:`, `${CMR_API_URL}?${cmrParams.toString()}`);

    const cmrResponse = await fetch(`${CMR_API_URL}?${cmrParams}`, {
      headers: { Accept: 'application/json' },
    });

    if (!cmrResponse.ok) {
      console.error('[ECOSTRESS] CMR error:', cmrResponse.status, await cmrResponse.text());
      break;
    }

    const cmrData = await cmrResponse.json() as CMRResponse;
    const granules = cmrData.feed?.entry || [];
    
    allGranules.push(...granules);
    
    // If we got fewer than page_size, we've reached the end
    hasMore = granules.length === CMR_PAGE_SIZE;
    page++;
  }
  
  console.log(`[ECOSTRESS] Fetched ${allGranules.length} total granules from ${page - 1} CMR pages`);
  return allGranules;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as RequestBody;
    const { lat, lon, region_bbox, date_from, date_to, min_quality_threshold, daytime_only, max_granules } = body;

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return new Response(
        JSON.stringify({ status: 'error', error: 'lat and lon are required numbers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const endDate = date_to || new Date().toISOString().split('T')[0];
    const startDate = date_from || getDateDaysAgo(365);
    const minQuality = min_quality_threshold ?? DEFAULT_MIN_QUALITY;
    const filterDaytime = daytime_only !== false; // Default to true
    const maxGranulesToReturn = max_granules ?? DEFAULT_MAX_GRANULES;

    // Build region bbox if not provided (default 1km grid cell around centroid)
    const regionBbox: [number, number, number, number] = region_bbox || [
      lon - 0.005, lat - 0.005, lon + 0.005, lat + 0.005
    ];

    console.log('[ECOSTRESS] Selection query:', {
      regionCentroid: { lat, lon },
      regionBbox,
      dateRange: `${startDate} to ${endDate}`,
      daytimeFilter: filterDaytime ? `${DAYTIME_START_LOCAL}:00-${DAYTIME_END_LOCAL}:00 (solar local)` : 'disabled',
      maxGranules: maxGranulesToReturn,
    });

    // Fetch ALL granules with pagination
    const granules = await fetchAllCMRGranules(regionBbox, startDate, endDate);

    if (granules.length === 0) {
      console.log('[ECOSTRESS] No granules found in CMR.');
      return new Response(
        JSON.stringify({
          status: 'no_coverage',
          message: `Keine ECOSTRESS-Daten für Region ${regionBbox.map(n => n.toFixed(3)).join(',')} im Zeitraum ${startDate} bis ${endDate} gefunden.`,
          attribution: 'NASA LP DAAC / ECOSTRESS',
          candidates_checked: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse bounds and score each granule
    const oldestDate = new Date(startDate);
    const newestDate = new Date(endDate);
    const scoredGranules: ScoredGranule[] = [];
    
    let skippedNighttime = 0;
    let skippedNoBounds = 0;
    let skippedNoIntersect = 0;
    
    for (const granule of granules) {
      const bounds = parseGranuleBounds(granule);
      if (!bounds) {
        skippedNoBounds++;
        continue;
      }
      
      const acquisitionTime = new Date(granule.time_start);
      const solarLocalHour = getSolarLocalHour(acquisitionTime, lon);
      
      // DAYTIME FILTER: Skip nighttime acquisitions for warmer surface temps
      if (filterDaytime) {
        if (solarLocalHour < DAYTIME_START_LOCAL || solarLocalHour >= DAYTIME_END_LOCAL) {
          skippedNighttime++;
          continue; // Skip this granule (nighttime)
        }
      }
      
      const intersectsRegion = pointInBbox(lon, lat, bounds) || bboxIntersects(regionBbox, bounds);
      const distanceToCentroid = distanceToBboxCenter(lon, lat, bounds);
      
      if (!intersectsRegion) {
        skippedNoIntersect++;
        continue;
      }
      
      // Calculate quality score for intersecting granules
      const { score, coverageRatio, cloudRatio, recencyScore } = calculateQualityScore(
        bounds,
        regionBbox,
        granule.cloud_cover,
        acquisitionTime,
        oldestDate,
        newestDate
      );
      
      scoredGranules.push({
        ...granule,
        wgs84Bounds: bounds,
        distanceToCentroid,
        intersectsRegion: true,
        coverageRatio,
        cloudRatio,
        recencyScore,
        qualityScore: score,
        solarLocalHour,
      });
    }

    // Sort by quality score (highest first)
    const intersecting = scoredGranules.sort((a, b) => b.qualityScore - a.qualityScore);

    console.log(
      `[ECOSTRESS] Results: ${intersecting.length} daytime intersecting granules from ${granules.length} total ` +
      `(skipped: ${skippedNighttime} nighttime, ${skippedNoBounds} no bounds, ${skippedNoIntersect} no intersect)`
    );

    // NO INTERSECTING GRANULES
    if (intersecting.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'no_coverage',
          message: filterDaytime 
            ? `Keine ECOSTRESS-Tagesaufnahmen (${DAYTIME_START_LOCAL}:00-${DAYTIME_END_LOCAL}:00 solar-lokal) decken die Region ab. ${skippedNighttime} Aufnahmen wurden herausgefiltert.`
            : `Keine ECOSTRESS-Aufnahme deckt die Region direkt ab.`,
          candidates_checked: granules.length,
          intersecting_count: 0,
          skipped_nighttime: skippedNighttime,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CAP at top N granules by quality score
    const topGranules = intersecting.slice(0, maxGranulesToReturn);
    
    console.log(
      `[ECOSTRESS] Returning top ${topGranules.length} granules (quality scores: ` +
      `${topGranules.slice(0, 3).map(g => g.qualityScore.toFixed(3)).join(', ')}...)`
    );

    // Build array of granule data with debug info
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
        solar_local_hour: granule.solarLocalHour.toFixed(1),
      };
    });

    // Best granule for backwards compatibility
    const bestGranule = topGranules[0];
    const { lstUrl, cloudMaskUrl } = findCogUrl(bestGranule);

    return new Response(
      JSON.stringify({
        status: 'match',
        // Primary: all granules for composite (capped)
        all_granules: allGranulesData,
        granule_count: allGranulesData.length,
        total_available: intersecting.length,
        // Legacy: best single granule
        cog_url: lstUrl,
        cloud_mask_url: cloudMaskUrl,
        datetime: bestGranule.time_start,
        granule_id: bestGranule.id,
        granule_bounds: bestGranule.wgs84Bounds,
        region_centroid: { lat, lon },
        quality_score: bestGranule.qualityScore,
        coverage_percent: Math.round(bestGranule.coverageRatio * 100),
        cloud_percent: Math.round(bestGranule.cloudRatio * 100),
        recency_score: bestGranule.recencyScore,
        // Debug stats
        candidates_checked: granules.length,
        intersecting_count: intersecting.length,
        skipped_nighttime: skippedNighttime,
        skipped_no_bounds: skippedNoBounds,
        skipped_no_intersect: skippedNoIntersect,
        daytime_filter: filterDaytime ? `${DAYTIME_START_LOCAL}:00-${DAYTIME_END_LOCAL}:00 solar-lokal` : null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[ECOSTRESS] Error:', err);
    return new Response(
      JSON.stringify({ status: 'error', error: err instanceof Error ? err.message : 'Unbekannter Fehler' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
