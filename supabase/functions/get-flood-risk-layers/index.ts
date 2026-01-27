/**
 * get-flood-risk-layers Edge Function
 * 
 * Returns available flood risk layer configurations from the registry
 * for a given location. Supports WMS, XYZ, and GeoTIFF layers.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  lat: number;
  lon: number;
  return_period?: number;
}

interface LayerRecord {
  key: string;
  name: string;
  type: string;
  url: string;
  layer_name: string | null;
  attribution: string;
  license: string | null;
  coverage: string | null;
  notes: string | null;
  return_period: number | null;
  is_active: boolean;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as RequestBody;
    const { lat, lon, return_period } = body;

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

    // Query available flood layers
    let query = supabase
      .from('map_layers_registry')
      .select('*')
      .eq('is_active', true)
      .or('key.ilike.%flood%,key.ilike.%gsw%')
      .order('return_period', { ascending: true, nullsFirst: false });

    // Filter by return period if specified
    if (return_period) {
      query = query.eq('return_period', return_period);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[FloodRisk] Query error:', error);
      return new Response(
        JSON.stringify({ status: 'error', error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check coverage (for now, just check if Europe or Global)
    const isInEurope = lat >= 34 && lat <= 72 && lon >= -25 && lon <= 45;

    // Build response layers
    const layers = (data as LayerRecord[])
      .filter((layer) => {
        // Filter by coverage
        if (layer.coverage === 'Europe' && !isInEurope) return false;
        return true;
      })
      .map((layer) => ({
        key: layer.key,
        name: layer.name,
        type: layer.type,
        url: layer.url,
        layer_name: layer.layer_name,
        attribution: layer.attribution,
        license: layer.license,
        return_period: layer.return_period,
        notes: layer.notes,
      }));

    // If no WMS layers available, provide fallback info
    if (layers.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'ok',
          layers: [],
          message: 'Keine Hochwasser-Layer für diese Region verfügbar.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prioritize layers: WMS > XYZ > GeoTIFF
    const sortedLayers = layers.sort((a, b) => {
      const priority: Record<string, number> = { wms: 0, xyz: 1, geotiff: 2 };
      return (priority[a.type] ?? 3) - (priority[b.type] ?? 3);
    });

    return new Response(
      JSON.stringify({
        status: 'ok',
        layers: sortedLayers,
        default_return_period: 100,
        available_return_periods: [...new Set(layers.map((l) => l.return_period).filter(Boolean))],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[FloodRisk] Error:', err);
    return new Response(
      JSON.stringify({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unbekannter Fehler',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
