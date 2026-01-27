/**
 * ecostress-latest-tile Edge Function
 * 
 * Discovers and returns the most recent NASA ECOSTRESS LST tile
 * for a given lat/lon coordinate.
 * 
 * Uses NASA CMR API to find granules and returns COG URLs.
 * Caches results in raster_sources_cache table for 30 days.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  lat: number;
  lon: number;
  date_from?: string;
  date_to?: string;
}

interface CMRGranule {
  id: string;
  title: string;
  time_start: string;
  time_end: string;
  links: Array<{
    href: string;
    rel: string;
    type?: string;
    title?: string;
  }>;
  cloud_cover?: number;
}

interface CMRResponse {
  feed: {
    entry: CMRGranule[];
  };
}

// ECOSTRESS ECO_L2T_LSTE collection concept ID
const ECOSTRESS_CONCEPT_ID = 'C2076090826-LPCLOUD';
const CMR_API_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json';

// Approximate MGRS tile size (110km at equator)
const TILE_SIZE_DEG = 1.0;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as RequestBody;
    const { lat, lon, date_from, date_to } = body;

    // Validate inputs
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return new Response(
        JSON.stringify({ status: 'error', error: 'lat and lon are required numbers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Calculate tile ID (simple grid)
    const tileId = `${Math.floor(lat)}_${Math.floor(lon)}`;
    
    // Date window
    const endDate = date_to || new Date().toISOString().split('T')[0];
    const startDate = date_from || getDateDaysAgo(21);

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

    if (cachedData?.cog_url) {
      console.log('[ECOSTRESS] Cache hit for tile:', tileId);
      return new Response(
        JSON.stringify({
          status: 'ok',
          cog_url: cachedData.cog_url,
          cloud_mask_url: cachedData.cloud_mask_url,
          datetime: cachedData.acquisition_datetime,
          qc_notes: cachedData.qc_notes,
          attribution: 'NASA LP DAAC / ECOSTRESS',
          value_unit: 'Kelvin',
          colormap_suggestion: 'thermal',
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for Earthdata credentials
    const earthdataUsername = Deno.env.get('EARTHDATA_USERNAME');
    const earthdataPassword = Deno.env.get('EARTHDATA_PASSWORD');
    const earthdataToken = Deno.env.get('EARTHDATA_TOKEN');

    const hasAuth = (earthdataUsername && earthdataPassword) || earthdataToken;

    // Build CMR query
    const bbox = `${lon - TILE_SIZE_DEG / 2},${lat - TILE_SIZE_DEG / 2},${lon + TILE_SIZE_DEG / 2},${lat + TILE_SIZE_DEG / 2}`;
    const cmrParams = new URLSearchParams({
      concept_id: ECOSTRESS_CONCEPT_ID,
      bounding_box: bbox,
      temporal: `${startDate}T00:00:00Z,${endDate}T23:59:59Z`,
      sort_key: '-start_date',
      page_size: '10',
    });

    console.log('[ECOSTRESS] Querying CMR:', cmrParams.toString());

    // Query NASA CMR
    const cmrResponse = await fetch(`${CMR_API_URL}?${cmrParams}`, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!cmrResponse.ok) {
      console.error('[ECOSTRESS] CMR error:', cmrResponse.status);
      return new Response(
        JSON.stringify({
          status: 'error',
          error: `NASA CMR query failed: ${cmrResponse.status}`,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cmrData = await cmrResponse.json() as CMRResponse;
    const granules = cmrData.feed?.entry || [];

    if (granules.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'no_data',
          qc_notes: `Keine ECOSTRESS-Daten für ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E im Zeitraum ${startDate} bis ${endDate} gefunden.`,
          attribution: 'NASA LP DAAC / ECOSTRESS',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find best granule (lowest cloud cover, most recent)
    const sortedGranules = granules.sort((a, b) => {
      // Prefer lower cloud cover
      const cloudA = a.cloud_cover ?? 100;
      const cloudB = b.cloud_cover ?? 100;
      if (cloudA !== cloudB) return cloudA - cloudB;
      // Then prefer more recent
      return new Date(b.time_start).getTime() - new Date(a.time_start).getTime();
    });

    const bestGranule = sortedGranules[0];
    
    // Find COG/TIFF link
    const dataLinks = bestGranule.links.filter(
      (link) => link.rel === 'http://esipfed.org/ns/fedsearch/1.1/data#' ||
                link.href.includes('.tif') ||
                link.href.includes('LSTE')
    );

    const lstLink = dataLinks.find((l) => l.href.includes('LST') || l.href.includes('LSTE'));
    const cloudMaskLink = dataLinks.find((l) => l.href.includes('QC') || l.href.includes('cloud'));

    if (!lstLink && !hasAuth) {
      return new Response(
        JSON.stringify({
          status: 'auth_required',
          qc_notes: 'ECOSTRESS erfordert Earthdata-Zugangsdaten. Bitte EARTHDATA_USERNAME und EARTHDATA_PASSWORD in Supabase Secrets konfigurieren.',
          granule_found: bestGranule.id,
          attribution: 'NASA LP DAAC / ECOSTRESS',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Construct COG URL (LP DAAC direct access or via S3)
    // For unauthenticated access, we'll use the STAC browser URL pattern
    const cogUrl = lstLink?.href || `https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/ECO_L2T_LSTE.002/${bestGranule.id}`;
    
    // Cache the result
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
        qc_notes: `Cloud cover: ${bestGranule.cloud_cover ?? 'unknown'}%`,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, {
        onConflict: 'tile_id,source_type,date_window_start,date_window_end',
      });
    } catch (cacheErr) {
      console.warn('[ECOSTRESS] Cache write failed:', cacheErr);
      // Non-fatal, continue
    }

    return new Response(
      JSON.stringify({
        status: 'ok',
        cog_url: cogUrl,
        cloud_mask_url: cloudMaskLink?.href || null,
        datetime: bestGranule.time_start,
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
      JSON.stringify({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unbekannter Fehler',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}
