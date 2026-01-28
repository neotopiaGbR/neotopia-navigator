/**
 * ecostress-proxy Edge Function
 * 
 * Simple streaming proxy that forwards NASA COG requests with Earthdata auth.
 * No raster processing—just adds authentication headers and streams the response.
 * Client-side deck.gl handles actual COG rendering.
 * 
 * Usage: /ecostress-proxy?url=<encoded-cog-url>
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, range, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const cogUrl = url.searchParams.get('url');

  if (!cogUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing url parameter' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Validate URL is from NASA Earthdata
  const allowed = [
    'data.lpdaac.earthdatacloud.nasa.gov',
    'e4ftl01.cr.usgs.gov',
    'ladsweb.modaps.eosdis.nasa.gov',
  ];
  
  try {
    const cogParsed = new URL(cogUrl);
    if (!allowed.some(d => cogParsed.hostname.endsWith(d))) {
      return new Response(
        JSON.stringify({ error: 'URL not in allowlist' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid URL' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Build auth headers
  const earthdataToken = Deno.env.get('EARTHDATA_TOKEN');
  const earthdataUsername = Deno.env.get('EARTHDATA_USERNAME');
  const earthdataPassword = Deno.env.get('EARTHDATA_PASSWORD');

  const authHeaders: Record<string, string> = {};
  if (earthdataToken) {
    authHeaders['Authorization'] = `Bearer ${earthdataToken}`;
  } else if (earthdataUsername && earthdataPassword) {
    const basicAuth = btoa(`${earthdataUsername}:${earthdataPassword}`);
    authHeaders['Authorization'] = `Basic ${basicAuth}`;
  }

  // Forward Range header for partial COG reads
  const rangeHeader = req.headers.get('Range');
  if (rangeHeader) {
    authHeaders['Range'] = rangeHeader;
  }

  console.log(`[ECOSTRESS-PROXY] Proxying: ${cogUrl.substring(0, 80)}...`);

  try {
    const response = await fetch(cogUrl, {
      method: req.method,
      headers: authHeaders,
    });

    // Build response headers
    const respHeaders = new Headers(corsHeaders);
    respHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
    
    const contentLength = response.headers.get('Content-Length');
    if (contentLength) respHeaders.set('Content-Length', contentLength);
    
    const contentRange = response.headers.get('Content-Range');
    if (contentRange) respHeaders.set('Content-Range', contentRange);
    
    respHeaders.set('Accept-Ranges', 'bytes');
    respHeaders.set('Cache-Control', 'public, max-age=86400');

    // Stream the response
    return new Response(response.body, {
      status: response.status,
      headers: respHeaders,
    });

  } catch (err) {
    console.error(`[ECOSTRESS-PROXY] Fetch error:`, err);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch COG', details: String(err) }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
