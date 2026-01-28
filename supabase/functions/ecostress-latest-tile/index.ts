/**
 * ecostress-latest-tile Edge Function
 * 
 * Discovers NASA ECOSTRESS LST tiles that INTERSECT the selected region.
 * Only returns "match" status if granule footprint contains region centroid.
 * Returns "no_coverage" with nearest candidate if no intersection found.
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

interface GranuleWithBounds extends CMRGranule {
  wgs84Bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  distanceToCentroid: number;
  intersectsRegion: boolean;
}

const ECOSTRESS_CONCEPT_ID = 'C2076090826-LPCLOUD';
const CMR_API_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json';
const TILE_SIZE_DEG = 1.0; // Search radius around point

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

/**
 * Parse MGRS tile ID to get approximate WGS84 bounds
 * MGRS format: 32UQC = Zone 32, Band U, 100km square QC
 */
function mgrsToApproxBounds(mgrsId: string): [number, number, number, number] | null {
  const match = mgrsId.match(/(\d{2})([C-X])([A-Z]{2})/i);
  if (!match) return null;
  
  const zone = parseInt(match[1], 10);
  const latBand = match[2].toUpperCase();
  
  // Approximate center longitude for UTM zone
  const zoneCenterLon = (zone - 1) * 6 - 180 + 3;
  
  // Approximate latitude band (rough mapping)
  const latBandMap: Record<string, number> = {
    'C': -80, 'D': -72, 'E': -64, 'F': -56, 'G': -48, 'H': -40, 'J': -32, 'K': -24,
    'L': -16, 'M': -8, 'N': 0, 'P': 8, 'Q': 16, 'R': 24, 'S': 32, 'T': 40,
    'U': 48, 'V': 56, 'W': 64, 'X': 72,
  };
  
  const latBandCenter = latBandMap[latBand] ?? 50;
  
  // ECOSTRESS tiles are roughly 109km x 109km
  // At mid-latitudes, this is approximately 1° lat x 1.5° lon
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
 * Check if point is inside bounding box
 */
function pointInBbox(
  lon: number, 
  lat: number, 
  bbox: [number, number, number, number]
): boolean {
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
 * Calculate distance between point and bbox center (in degrees, approximate)
 */
function distanceToBboxCenter(
  lon: number, 
  lat: number, 
  bbox: [number, number, number, number]
): number {
  const centerLon = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  
  // Haversine distance in km
  const R = 6371;
  const dLat = (centerLat - lat) * Math.PI / 180;
  const dLon = (centerLon - lon) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat * Math.PI / 180) * Math.cos(centerLat * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as RequestBody;
    const { lat, lon, region_bbox, date_from, date_to } = body;

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return new Response(
        JSON.stringify({ status: 'error', error: 'lat and lon are required numbers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const tileId = `${Math.floor(lat)}_${Math.floor(lon)}`;
    const endDate = date_to || new Date().toISOString().split('T')[0];
    const startDate = date_from || getDateDaysAgo(365);

    // Build region bbox if not provided (1km grid cell around centroid)
    const regionBbox: [number, number, number, number] = region_bbox || [
      lon - 0.005, lat - 0.005, lon + 0.005, lat + 0.005
    ];

    console.log('[ECOSTRESS] Query params:', {
      regionCentroid: { lat, lon },
      regionBbox,
      dateRange: `${startDate} to ${endDate}`,
    });

    // Check cache first
    const { data: cachedData } = await supabase
      .from('raster_sources_cache')
      .select('*')
      .eq('tile_id', tileId)
      .eq('source_type', 'ecostress_lst')
      .gte('date_window_start', startDate)
      .lte('date_window_end', endDate)
      .gt('expires_at', new Date().toISOString())
      .order('acquisition_datetime', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Validate cached result still intersects (in case region changed)
    if (cachedData?.cog_url) {
      const cachedBounds = cachedData.granule_bounds as [number, number, number, number] | null;
      if (cachedBounds && pointInBbox(lon, lat, cachedBounds)) {
        console.log('[ECOSTRESS] Cache hit with valid intersection for tile:', tileId);
        return new Response(
          JSON.stringify({
            status: 'match',
            cog_url: cachedData.cog_url,
            cloud_mask_url: cachedData.cloud_mask_url,
            datetime: cachedData.acquisition_datetime,
            granule_bounds: cachedBounds,
            qc_notes: cachedData.qc_notes,
            attribution: 'NASA LP DAAC / ECOSTRESS',
            value_unit: 'Kelvin',
            colormap_suggestion: 'thermal',
            cached: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Query NASA CMR with larger bbox to find all candidates
    const searchBbox = `${lon - TILE_SIZE_DEG},${lat - TILE_SIZE_DEG},${lon + TILE_SIZE_DEG},${lat + TILE_SIZE_DEG}`;
    const cmrParams = new URLSearchParams({
      concept_id: ECOSTRESS_CONCEPT_ID,
      bounding_box: searchBbox,
      temporal: `${startDate}T00:00:00Z,${endDate}T23:59:59Z`,
      sort_key: '-start_date',
      page_size: '50', // Get more results to find intersecting tiles
    });

    console.log('[ECOSTRESS] Querying CMR:', { lat, lon, searchBbox });

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
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse bounds and calculate intersection for each granule
    const granulesWithBounds: GranuleWithBounds[] = [];
    
    for (const granule of granules) {
      const bounds = parseGranuleBounds(granule);
      if (!bounds) {
        console.log('[ECOSTRESS] Could not parse bounds for:', granule.id);
        continue;
      }
      
      const intersectsRegion = pointInBbox(lon, lat, bounds) || 
                               bboxIntersects(regionBbox, bounds);
      const distanceToCentroid = distanceToBboxCenter(lon, lat, bounds);
      
      granulesWithBounds.push({
        ...granule,
        wgs84Bounds: bounds,
        distanceToCentroid,
        intersectsRegion,
      });
      
      console.log('[ECOSTRESS] Granule evaluation:', {
        id: granule.id,
        bounds,
        intersectsRegion,
        distanceKm: distanceToCentroid.toFixed(1),
      });
    }

    // Separate intersecting and non-intersecting granules
    const intersecting = granulesWithBounds
      .filter(g => g.intersectsRegion)
      .sort((a, b) => {
        // Prefer lower cloud cover
        const cloudA = a.cloud_cover ?? 100;
        const cloudB = b.cloud_cover ?? 100;
        if (cloudA !== cloudB) return cloudA - cloudB;
        // Then prefer more recent
        return new Date(b.time_start).getTime() - new Date(a.time_start).getTime();
      });

    const nearest = granulesWithBounds
      .filter(g => !g.intersectsRegion)
      .sort((a, b) => a.distanceToCentroid - b.distanceToCentroid)[0];

    console.log('[ECOSTRESS] Selection result:', {
      totalGranules: granules.length,
      withParsedBounds: granulesWithBounds.length,
      intersecting: intersecting.length,
      nearestNonIntersecting: nearest?.id,
      nearestDistance: nearest?.distanceToCentroid.toFixed(1),
    });

    // NO INTERSECTING GRANULE FOUND
    if (intersecting.length === 0) {
      const response: Record<string, unknown> = {
        status: 'no_coverage',
        message: `Keine ECOSTRESS-Aufnahme deckt die ausgewählte Region (${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E) ab.`,
        region_centroid: { lat, lon },
        region_bbox: regionBbox,
        attribution: 'NASA LP DAAC / ECOSTRESS',
      };

      // Include nearest candidate for optional display
      if (nearest) {
        response.nearest_candidate = {
          granule_id: nearest.id,
          datetime: nearest.time_start,
          bounds: nearest.wgs84Bounds,
          distance_km: Math.round(nearest.distanceToCentroid),
          cloud_cover: nearest.cloud_cover,
        };
        response.message = `Keine ECOSTRESS-Aufnahme deckt die Region direkt ab. Nächste Aufnahme: ${Math.round(nearest.distanceToCentroid)} km entfernt.`;
      }

      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // FOUND INTERSECTING GRANULE
    const bestGranule = intersecting[0];
    console.log('[ECOSTRESS] Selected intersecting granule:', bestGranule.id);

    // Find LST COG URL
    const dataLinks = bestGranule.links.filter(
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

    const cogUrl = finalLstLink?.href || 
      `https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/ECO_L2T_LSTE.002/${bestGranule.id}/${bestGranule.id}_LST.tif`;

    console.log('[ECOSTRESS] Selected COG URL:', cogUrl);

    // Cache the result with bounds
    try {
      await supabase.from('raster_sources_cache').upsert({
        tile_id: tileId,
        source_type: 'ecostress_lst',
        lat,
        lon,
        cog_url: cogUrl,
        cloud_mask_url: cloudMaskLink?.href || null,
        acquisition_datetime: bestGranule.time_start,
        date_window_start: startDate,
        date_window_end: endDate,
        granule_id: bestGranule.id,
        granule_bounds: bestGranule.wgs84Bounds,
        qc_notes: `Cloud cover: ${bestGranule.cloud_cover ?? 'unknown'}%`,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'tile_id,source_type,date_window_start,date_window_end' });
    } catch (cacheErr) {
      console.warn('[ECOSTRESS] Cache write failed:', cacheErr);
    }

    return new Response(
      JSON.stringify({
        status: 'match',
        cog_url: cogUrl,
        cloud_mask_url: cloudMaskLink?.href || null,
        datetime: bestGranule.time_start,
        granule_id: bestGranule.id,
        granule_bounds: bestGranule.wgs84Bounds,
        region_centroid: { lat, lon },
        qc_notes: `Granule: ${bestGranule.id}. Cloud cover: ${bestGranule.cloud_cover ?? 'unknown'}%`,
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
