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

// ECOSTRESS tiles are ~70km on a side, so expand search box significantly
const TILE_SIZE_DEG = 0.5; // Use smaller box to get tiles centered on the point

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
    
    // Date window - ECOSTRESS has sparse coverage, use wider window
    const endDate = date_to || new Date().toISOString().split('T')[0];
    const startDate = date_from || getDateDaysAgo(60); // Expand to 60 days for better coverage

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

    // Build CMR query - use a point query for more precise results
    const bbox = `${lon - TILE_SIZE_DEG},${lat - TILE_SIZE_DEG},${lon + TILE_SIZE_DEG},${lat + TILE_SIZE_DEG}`;
    const cmrParams = new URLSearchParams({
      concept_id: ECOSTRESS_CONCEPT_ID,
      bounding_box: bbox,
      temporal: `${startDate}T00:00:00Z,${endDate}T23:59:59Z`,
      sort_key: '-start_date',
      page_size: '20', // Get more results to find best match
    });

    console.log('[ECOSTRESS] Querying CMR for coords:', lat, lon, 'bbox:', bbox);
    console.log('[ECOSTRESS] Full CMR query:', cmrParams.toString());

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
    // Also filter to only tiles that actually contain the requested point
    const sortedGranules = granules
      .filter(g => {
        // Extract MGRS tile from granule ID (e.g., 32UQC from the title/id)
        // Check if the granule's spatial footprint actually contains our point
        // For now, we sort by proximity to the center if we can parse it
        return true; // Will sort by cloud cover and recency
      })
      .sort((a, b) => {
        // Prefer lower cloud cover
        const cloudA = a.cloud_cover ?? 100;
        const cloudB = b.cloud_cover ?? 100;
        if (cloudA !== cloudB) return cloudA - cloudB;
        // Then prefer more recent
        return new Date(b.time_start).getTime() - new Date(a.time_start).getTime();
      });

    if (sortedGranules.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'no_data',
          qc_notes: `Keine ECOSTRESS-Daten direkt über ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E verfügbar. Die nächsten Aufnahmen liegen außerhalb der Region.`,
          attribution: 'NASA LP DAAC / ECOSTRESS',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const bestGranule = sortedGranules[0];
    
    // Log the selected tile for debugging
    console.log('[ECOSTRESS] Selected granule:', bestGranule.id, 'for coordinates:', lat, lon);
    
    // Find COG/TIFF link - exclude auxiliary files (water, cloud, QC, EmisWB)
    const dataLinks = bestGranule.links.filter(
      (link) => link.rel === 'http://esipfed.org/ns/fedsearch/1.1/data#' ||
                link.href.includes('.tif')
    );

    // Find the actual LST file - must end with _LST.tif and NOT be water/cloud/QC/EmisWB
    const lstLink = dataLinks.find((l) => {
      const href = l.href.toLowerCase();
      const isLstFile = href.endsWith('_lst.tif') || href.includes('_lst_');
      const isAuxFile = href.includes('_water') || href.includes('_cloud') || 
                        href.includes('_qc') || href.includes('_emiswb') ||
                        href.includes('_emis1') || href.includes('_emis2') ||
                        href.includes('_emis3') || href.includes('_emis4') ||
                        href.includes('_emis5');
      return isLstFile && !isAuxFile;
    });
    
    // If no specific LST file found, try broader match but still exclude auxiliary files
    const fallbackLstLink = !lstLink ? dataLinks.find((l) => {
      const href = l.href.toLowerCase();
      const hasLste = href.includes('lste') && href.endsWith('.tif');
      const isAuxFile = href.includes('_water') || href.includes('_cloud') || 
                        href.includes('_qc') || href.includes('_emiswb') ||
                        href.includes('_emis');
      return hasLste && !isAuxFile;
    }) : null;
    
    const finalLstLink = lstLink || fallbackLstLink;
    const cloudMaskLink = dataLinks.find((l) => l.href.includes('QC') || l.href.includes('cloud'));

    if (!finalLstLink && !hasAuth) {
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

    // Construct COG URL - use detected LST file or build expected path
    const cogUrl = finalLstLink?.href || `https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/ECO_L2T_LSTE.002/${bestGranule.id}/${bestGranule.id}_LST.tif`;
    
    console.log('[ECOSTRESS] Selected COG URL:', cogUrl);
    
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
