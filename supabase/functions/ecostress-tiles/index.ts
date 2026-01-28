/**
 * ecostress-tiles Edge Function
 * 
 * Server-side COG → XYZ tile proxy for NASA ECOSTRESS LST data.
 * Fetches Cloud-Optimized GeoTIFF tiles with Earthdata auth and
 * returns colorized PNG tiles for MapLibre consumption.
 * 
 * Endpoint: /tiles/{z}/{x}/{y}.png?cog_url=...
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import * as GeoTIFF from 'https://esm.sh/geotiff@2.1.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // Keep in sync with Supabase web client preflight headers
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Tile size in pixels
const TILE_SIZE = 256;

// LST temperature range for colormap (Kelvin)
const LST_MIN = 273; // 0°C
const LST_MAX = 323; // 50°C

// RGBA color tuple type
type RGBAColor = [number, number, number, number];

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 1x1 transparent PNG (works fine as a "blank" tile and avoids crashes on error paths)
const TRANSPARENT_PNG_1X1 = base64ToUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAp1r3p0AAAAASUVORK5CYII='
);

/**
 * Heat colormap: blue (cold) → cyan → green → yellow → red (hot)
 * Input: normalized value 0-1
 * Output: [r, g, b, a] 0-255
 */
function heatColormap(value: number): RGBAColor {
  // Clamp to 0-1
  const t = Math.max(0, Math.min(1, value));
  
  let r: number;
  let g: number;
  let b: number;
  
  if (t < 0.25) {
    // Blue to Cyan (0 - 0.25)
    const s = t / 0.25;
    r = 0;
    g = Math.round(255 * s);
    b = 255;
  } else if (t < 0.5) {
    // Cyan to Green (0.25 - 0.5)
    const s = (t - 0.25) / 0.25;
    r = 0;
    g = 255;
    b = Math.round(255 * (1 - s));
  } else if (t < 0.75) {
    // Green to Yellow (0.5 - 0.75)
    const s = (t - 0.5) / 0.25;
    r = Math.round(255 * s);
    g = 255;
    b = 0;
  } else {
    // Yellow to Red (0.75 - 1.0)
    const s = (t - 0.75) / 0.25;
    r = 255;
    g = Math.round(255 * (1 - s));
    b = 0;
  }
  
  return [r, g, b, 255];
}

/**
 * Convert tile coordinates to geographic bounds
 */
function tileToBounds(z: number, x: number, y: number): { west: number; south: number; east: number; north: number } {
  const n = Math.pow(2, z);
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  
  const latRadN = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const latRadS = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  
  const north = (latRadN * 180) / Math.PI;
  const south = (latRadS * 180) / Math.PI;
  
  return { west, south, east, north };
}

/**
 * Create a simple PNG from RGBA data
 * Uses a minimal PNG encoder for Deno
 */
async function createPNG(width: number, height: number, rgba: Uint8ClampedArray): Promise<Uint8Array> {
  // Use native CompressionStream for zlib/deflate (avoids esm.sh runtime incompatibilities)
  async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    // Ensure the underlying buffer is an ArrayBuffer (not ArrayBufferLike) to satisfy Deno's TS types
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    await writer.write(bytes);
    await writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  }
  
  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = new Uint8Array(25);
  const ihdrData = new DataView(ihdr.buffer);
  ihdrData.setUint32(0, 13, false); // Length
  ihdr[4] = 73; ihdr[5] = 72; ihdr[6] = 68; ihdr[7] = 82; // "IHDR"
  ihdrData.setUint32(8, width, false);
  ihdrData.setUint32(12, height, false);
  ihdr[16] = 8; // Bit depth
  ihdr[17] = 6; // Color type (RGBA)
  ihdr[18] = 0; // Compression
  ihdr[19] = 0; // Filter
  ihdr[20] = 0; // Interlace
  const ihdrCrc = crc32(ihdr.subarray(4, 21));
  ihdrData.setUint32(21, ihdrCrc, false);
  
  // IDAT chunk - filter and compress pixel data
  const rawData = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      rawData[dstIdx] = rgba[srcIdx];
      rawData[dstIdx + 1] = rgba[srcIdx + 1];
      rawData[dstIdx + 2] = rgba[srcIdx + 2];
      rawData[dstIdx + 3] = rgba[srcIdx + 3];
    }
  }
  
  const compressed = await zlibDeflate(rawData);
  const idat = new Uint8Array(12 + compressed.length);
  const idatView = new DataView(idat.buffer);
  idatView.setUint32(0, compressed.length, false);
  idat[4] = 73; idat[5] = 68; idat[6] = 65; idat[7] = 84; // "IDAT"
  idat.set(compressed, 8);
  const idatCrc = crc32(idat.subarray(4, 8 + compressed.length));
  idatView.setUint32(8 + compressed.length, idatCrc, false);
  
  // IEND chunk
  const iend = new Uint8Array([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  
  // Combine all chunks
  const png = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let offset = 0;
  png.set(signature, offset); offset += signature.length;
  png.set(ihdr, offset); offset += ihdr.length;
  png.set(idat, offset); offset += idat.length;
  png.set(iend, offset);
  
  return png;
}

// CRC32 lookup table
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Create a transparent tile
 */
async function createTransparentTile(): Promise<ArrayBuffer> {
  // Never throw from fallback path.
  return TRANSPARENT_PNG_1X1.buffer as ArrayBuffer;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  
  // Expected path: /ecostress-tiles/tiles/{z}/{x}/{y}.png
  // Or: /ecostress-tiles?z=...&x=...&y=...&cog_url=...
  
  let z: number, x: number, y: number;
  let cogUrl: string | null = null;
  let regionId: string | null = null;
  
  // Parse from query params (primary method)
  const zParam = url.searchParams.get('z');
  const xParam = url.searchParams.get('x');
  const yParam = url.searchParams.get('y');
  cogUrl = url.searchParams.get('cog_url');
  regionId = url.searchParams.get('region_id');
  
  if (zParam && xParam && yParam) {
    z = parseInt(zParam, 10);
    x = parseInt(xParam, 10);
    y = parseInt(yParam.replace('.png', ''), 10);
  } else {
    // Try path-based parsing
    const tilesIdx = pathParts.indexOf('tiles');
    if (tilesIdx !== -1 && pathParts.length >= tilesIdx + 4) {
      z = parseInt(pathParts[tilesIdx + 1], 10);
      x = parseInt(pathParts[tilesIdx + 2], 10);
      y = parseInt(pathParts[tilesIdx + 3].replace('.png', ''), 10);
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid tile coordinates. Use ?z=&x=&y= or /tiles/{z}/{x}/{y}.png' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
  
  if (isNaN(z) || isNaN(x) || isNaN(y)) {
    return new Response(
      JSON.stringify({ error: 'Invalid tile coordinates' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  console.log(`[ECOSTRESS-TILES] Request for tile z=${z} x=${x} y=${y}`);
  
  try {
    // If no COG URL provided, look up from cache or discover
    if (!cogUrl && regionId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      
      // Get the latest cached COG URL for this region
      const bounds = tileToBounds(z, x, y);
      const centerLat = (bounds.north + bounds.south) / 2;
      const centerLon = (bounds.east + bounds.west) / 2;
      const tileId = `${Math.floor(centerLat)}_${Math.floor(centerLon)}`;
      
      const { data: cached } = await supabase
        .from('raster_sources_cache')
        .select('cog_url')
        .eq('tile_id', tileId)
        .eq('source_type', 'ecostress_lst')
        .gt('expires_at', new Date().toISOString())
        .order('acquisition_datetime', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (cached?.cog_url) {
        cogUrl = cached.cog_url;
        console.log(`[ECOSTRESS-TILES] Using cached COG URL: ${cogUrl}`);
      }
    }
    
    if (!cogUrl) {
      // Return transparent tile if no COG available
      console.log(`[ECOSTRESS-TILES] No COG URL available, returning transparent tile`);
      const transparentTile = await createTransparentTile();
      return new Response(transparentTile, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
        },
      });
    }
    
    // Get Earthdata credentials
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
    
    // Calculate tile bounds
    const bounds = tileToBounds(z, x, y);
    console.log(`[ECOSTRESS-TILES] Tile bounds: ${JSON.stringify(bounds)}`);
    
    // Fetch COG with HTTP range requests (COG supports partial reads)
    const tiff = await GeoTIFF.fromUrl(cogUrl, {
      headers: authHeaders,
      allowFullFile: false,
    });
    
    // Get the first image (LST band)
    const image = await tiff.getImage();
    const imageWidth = image.getWidth();
    const imageHeight = image.getHeight();
    const imageBounds = image.getBoundingBox();
    
    console.log(`[ECOSTRESS-TILES] Image size: ${imageWidth}x${imageHeight}, bounds: ${JSON.stringify(imageBounds)}`);
    
    // Check if tile is within image bounds
    const [imgWest, imgSouth, imgEast, imgNorth] = imageBounds;
    if (bounds.east < imgWest || bounds.west > imgEast || 
        bounds.north < imgSouth || bounds.south > imgNorth) {
      // Tile is outside image bounds
      console.log(`[ECOSTRESS-TILES] Tile outside image bounds, returning transparent`);
      const transparentTile = await createTransparentTile();
      return new Response(transparentTile, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    
    // Calculate pixel window for this tile
    const pixelWidth = (imgEast - imgWest) / imageWidth;
    const pixelHeight = (imgNorth - imgSouth) / imageHeight;
    
    const left = Math.max(0, Math.floor((bounds.west - imgWest) / pixelWidth));
    const right = Math.min(imageWidth, Math.ceil((bounds.east - imgWest) / pixelWidth));
    const top = Math.max(0, Math.floor((imgNorth - bounds.north) / pixelHeight));
    const bottom = Math.min(imageHeight, Math.ceil((imgNorth - bounds.south) / pixelHeight));
    
    const windowWidth = right - left;
    const windowHeight = bottom - top;
    
    if (windowWidth <= 0 || windowHeight <= 0) {
      console.log(`[ECOSTRESS-TILES] Invalid window, returning transparent`);
      const transparentTile = await createTransparentTile();
      return new Response(transparentTile, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    
    console.log(`[ECOSTRESS-TILES] Reading window: left=${left}, top=${top}, width=${windowWidth}, height=${windowHeight}`);
    
    // Read the pixel data for this window, resampled to tile size
    const rasters = await image.readRasters({
      window: [left, top, right, bottom],
      width: TILE_SIZE,
      height: TILE_SIZE,
      interleave: false,
    });
    
    const lstData = rasters[0] as Float32Array | Float64Array | Uint16Array;
    
    // Create RGBA tile
    const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
      const value = lstData[i];
      
      // Check for nodata (typically 0 or very low values for LST)
      if (value <= 0 || value < 200 || isNaN(value)) {
        // Transparent
        rgba[i * 4] = 0;
        rgba[i * 4 + 1] = 0;
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 0;
      } else {
        // Normalize to colormap range
        const normalized = (value - LST_MIN) / (LST_MAX - LST_MIN);
        const [r, g, b, a] = heatColormap(normalized);
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = a;
      }
    }
    
    // Encode as PNG
    const pngData = await createPNG(TILE_SIZE, TILE_SIZE, rgba);
    
    console.log(`[ECOSTRESS-TILES] Generated tile: ${pngData.length} bytes`);
    
    // Return tile with caching headers
    return new Response(pngData.buffer as ArrayBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
        'ETag': `"${z}-${x}-${y}-${Date.now()}"`,
      },
    });
    
  } catch (err) {
    console.error(`[ECOSTRESS-TILES] Error:`, err);
    
    // Return transparent tile on error (graceful degradation)
    const transparentTile = await createTransparentTile();
    return new Response(transparentTile, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60', // Short cache on error
      },
    });
  }
});
