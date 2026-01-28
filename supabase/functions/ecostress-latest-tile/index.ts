/**
 * ecostress-latest-tile Edge Function
 * 
 * Discovers NASA ECOSTRESS LST tiles that INTERSECT the selected region.
 * Uses quality-based scoring to select the BEST granule, not just the newest.
 * 
 * Scoring formula:
 *   score = 0.4 * coverage_ratio + 0.3 * valid_pixel_estimate + 0.2 * (1 - cloud_ratio) + 0.1 * recency
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  lat: number;
  lon: number;
  region_bbox?: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  date_from?: string;
  date_to?: string;
  min_quality_threshold?: number; // Minimum quality score (0-1), default 0.2
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
  feed: { entry: CMRGranule[] };
}

interface ScoredGranule extends CMRGranule {
  wgs84Bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  distanceToCentroid: number;
  intersectsRegion: boolean;
  coverageRatio: number; // 0-1: how much of region is covered
  cloudRatio: number; // 0-1: cloud cover percentage
  recencyScore: number; // 0-1: how recent (1 = today, 0 = oldest)
  qualityScore: number; // Combined weighted score
}

const ECOSTRESS_CONCEPT_ID = 'C2076090826-LPCLOUD';
const CMR_API_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json';
const SEARCH_RADIUS_DEG = 2.0; // Larger search radius to find more candidates
const DEFAULT_MIN_QUALITY = 0.20; // Minimum quality threshold (coverage ≥80% recommended)

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
  
  // Fallback: try to extract MGRS tile ID from granule ID
  const mgrsMatch = granule.id.match(/(\d{2}[C-X][A-Z]{2})/i);
  if (mgrsMatch) {
    return mgrsToApproxBounds(mgrsMatch[1]);
  }
  
  return null;
}

/**
 * Parse MGRS tile ID to get approximate WGS84 bounds
 */
function mgrsToApproxBounds(mgrsId: string): [number, number, number, number] | null {
  const match = mgrsId.match(/(\d{2})([C-X])([A-Z]{2})/i);
  if (!match) return null;
  
  const zone = parseInt(match[1], 10);
  const latBand = match[2].toUpperCase();
  
  // Approximate center longitude for UTM zone
  const zoneCenterLon = (zone - 1) * 6 - 180 + 3;
  
  // Approximate latitude band
  const latBandMap: Record<string, number> = {
    'C': -80, 'D': -72, 'E': -64, 'F': -56, 'G': -48, 'H': -40, 'J': -32, 'K': -24,
    'L': -16, 'M': -8, 'N': 0, 'P': 8, 'Q': 16, 'R': 24, 'S': 32, 'T': 40,
    'U': 48, 'V': 56, 'W': 64, 'X': 72,
  };
  
  const latBandCenter = latBandMap[latBand] ?? 50;
  
  // ECOSTRESS tiles are roughly 109km x 109km (~1° lat x 1.5° lon at mid-latitudes)
  const latHalf = 0.55;
  const lonHalf = 0.85;
  
  return [
    zoneCenterLon - lonHalf,
    latBandCenter - latHalf,
    zoneCenterLon + lonHalf,
    latBandCenter + latHalf,
  ];
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
 * Weights: coverage=0.4, valid_pixels=0.3, cloud=0.2, recency=0.1
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
  // This is an approximation - actual valid pixels require reading the COG
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as RequestBody;
    const { lat, lon, region_bbox, date_from, date_to, min_quality_threshold } = body;

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return new Response(
        JSON.stringify({ status: 'error', error: 'lat and lon are required numbers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const endDate = date_to || new Date().toISOString().split('T')[0];
    const startDate = date_from || getDateDaysAgo(365);
    const minQuality = min_quality_threshold ?? DEFAULT_MIN_QUALITY;

    // Build region bbox if not provided (1km grid cell around centroid)
    const regionBbox: [number, number, number, number] = region_bbox || [
      lon - 0.005, lat - 0.005, lon + 0.005, lat + 0.005
    ];

    console.log('[ECOSTRESS] Quality-based selection query:', {
      regionCentroid: { lat, lon },
      regionBbox,
      dateRange: `${startDate} to ${endDate}`,
      minQualityThreshold: minQuality,
    });

    // Query NASA CMR with larger bbox to find ALL candidates
    const searchBbox = `${lon - SEARCH_RADIUS_DEG},${lat - SEARCH_RADIUS_DEG},${lon + SEARCH_RADIUS_DEG},${lat + SEARCH_RADIUS_DEG}`;
    const cmrParams = new URLSearchParams({
      concept_id: ECOSTRESS_CONCEPT_ID,
      bounding_box: searchBbox,
      temporal: `${startDate}T00:00:00Z,${endDate}T23:59:59Z`,
      sort_key: '-start_date',
      page_size: '200', // Get more granules for comprehensive scoring
    });

    console.log('[ECOSTRESS] Querying CMR for all candidates:', { lat, lon, searchBbox });

    const cmrResponse = await fetch(`${CMR_API_URL}?${cmrParams}`, {
      headers: { Accept: 'application/json' },
    });

    if (!cmrResponse.ok) {
      console.error('[ECOSTRESS] CMR error:', cmrResponse.status);
      return new Response(
        JSON.stringify({ status: 'error', error: `NASA CMR query failed: ${cmrResponse.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cmrData = await cmrResponse.json() as CMRResponse;
    const granules = cmrData.feed?.entry || [];

    if (granules.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'no_coverage',
          message: `Keine ECOSTRESS-Daten im Umkreis von ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E im Zeitraum ${startDate} bis ${endDate} gefunden.`,
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
    
    for (const granule of granules) {
      const bounds = parseGranuleBounds(granule);
      if (!bounds) {
        console.log('[ECOSTRESS] Could not parse bounds for:', granule.id);
        continue;
      }
      
      const intersectsRegion = pointInBbox(lon, lat, bounds) || bboxIntersects(regionBbox, bounds);
      const distanceToCentroid = distanceToBboxCenter(lon, lat, bounds);
      
      if (!intersectsRegion) {
        // Track non-intersecting for "nearest" fallback
        scoredGranules.push({
          ...granule,
          wgs84Bounds: bounds,
          distanceToCentroid,
          intersectsRegion: false,
          coverageRatio: 0,
          cloudRatio: (granule.cloud_cover ?? 50) / 100,
          recencyScore: 0,
          qualityScore: 0,
        });
        continue;
      }
      
      // Calculate quality score for intersecting granules
      const acquisitionDate = new Date(granule.time_start);
      const { score, coverageRatio, cloudRatio, recencyScore } = calculateQualityScore(
        bounds,
        regionBbox,
        granule.cloud_cover,
        acquisitionDate,
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
      });
      
      console.log('[ECOSTRESS] Scored granule:', {
        id: granule.id,
        date: granule.time_start.split('T')[0],
        coverageRatio: (coverageRatio * 100).toFixed(1) + '%',
        cloudCover: ((cloudRatio) * 100).toFixed(0) + '%',
        recency: (recencyScore * 100).toFixed(0) + '%',
        qualityScore: score.toFixed(3),
      });
    }

    // Sort by quality score (highest first)
    const intersecting = scoredGranules
      .filter(g => g.intersectsRegion)
      .sort((a, b) => b.qualityScore - a.qualityScore);

    const nearestNonIntersecting = scoredGranules
      .filter(g => !g.intersectsRegion)
      .sort((a, b) => a.distanceToCentroid - b.distanceToCentroid)[0];

    console.log('[ECOSTRESS] Selection summary:', {
      totalGranules: granules.length,
      withParsedBounds: scoredGranules.length,
      intersecting: intersecting.length,
      topQualityScore: intersecting[0]?.qualityScore.toFixed(3),
      nearestNonIntersecting: nearestNonIntersecting?.id,
      nearestDistance: nearestNonIntersecting?.distanceToCentroid.toFixed(1),
    });

    // NO INTERSECTING GRANULES
    if (intersecting.length === 0) {
      const response: Record<string, unknown> = {
        status: 'no_coverage',
        region_centroid: { lat, lon },
        region_bbox: regionBbox,
        attribution: 'NASA LP DAAC / ECOSTRESS',
        candidates_checked: granules.length,
        intersecting_count: 0,
      };

      if (nearestNonIntersecting) {
        response.message = `Keine ECOSTRESS-Aufnahme deckt die Region ab. Nächste Aufnahme: ${Math.round(nearestNonIntersecting.distanceToCentroid)} km entfernt.`;
        response.nearest_candidate = {
          granule_id: nearestNonIntersecting.id,
          datetime: nearestNonIntersecting.time_start,
          bounds: nearestNonIntersecting.wgs84Bounds,
          distance_km: Math.round(nearestNonIntersecting.distanceToCentroid),
          cloud_cover: nearestNonIntersecting.cloud_cover,
        };
      } else {
        response.message = `Keine ECOSTRESS-Aufnahme im Umkreis von ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E gefunden.`;
      }

      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // RETURN ALL INTERSECTING GRANULES for composite layering
    // Sort by date (newest first) for proper layer ordering
    const sortedByDate = intersecting.sort((a, b) => 
      new Date(b.time_start).getTime() - new Date(a.time_start).getTime()
    );

    // Build array of all granule data
    const allGranules = sortedByDate.map(granule => {
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
      };
    });

    console.log('[ECOSTRESS] Returning all intersecting granules for composite:', {
      count: allGranules.length,
      dateRange: allGranules.length > 0 
        ? `${allGranules[allGranules.length - 1].datetime.split('T')[0]} to ${allGranules[0].datetime.split('T')[0]}`
        : 'none',
    });

    // Also return the best granule for backwards compatibility
    const bestGranule = sortedByDate.sort((a, b) => b.qualityScore - a.qualityScore)[0];
    const { lstUrl, cloudMaskUrl } = findCogUrl(bestGranule);

    return new Response(
      JSON.stringify({
        status: 'match',
        // Primary: all granules for composite
        all_granules: allGranules,
        granule_count: allGranules.length,
        // Legacy: best single granule for backwards compatibility
        cog_url: lstUrl,
        cloud_mask_url: cloudMaskUrl,
        datetime: bestGranule.time_start,
        granule_id: bestGranule.id,
        granule_bounds: bestGranule.wgs84Bounds,
        region_centroid: { lat, lon },
        // Quality metrics for best granule
        quality_score: bestGranule.qualityScore,
        coverage_percent: Math.round(bestGranule.coverageRatio * 100),
        cloud_percent: Math.round(bestGranule.cloudRatio * 100),
        recency_score: bestGranule.recencyScore,
        // Selection metadata
        candidates_checked: granules.length,
        intersecting_count: intersecting.length,
        qc_notes: `${allGranules.length} Aufnahmen gefunden (${startDate} bis ${endDate})`,
        attribution: 'NASA LP DAAC / ECOSTRESS',
        value_unit: 'Kelvin',
        colormap_suggestion: 'thermal',
        cached: false,
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
