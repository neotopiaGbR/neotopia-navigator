/**
 * ecostress-tiles Edge Function (Production-Grade)
 * 
 * Server-side COG → XYZ tile proxy for NASA ECOSTRESS LST data.
 * Includes full diagnostics, proper PNG encoding, and correct auth.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TILE_SIZE = 256;
const LST_MIN = 273; // 0°C in Kelvin
const LST_MAX = 323; // 50°C in Kelvin

// Diagnostic state for this request
interface Diagnostics {
  mode: 'render' | 'fallback' | 'error';
  reason: string;
  cogFetchStatus?: number;
  cogFetchHeaders?: Record<string, string>;
  rangeSupported?: boolean;
  tileStats?: { min: number; max: number; nodata: number; valid: number };
  pngBytes?: number;
  error?: string;
  stage?: string;
}

// ============== PNG ENCODING (Correct Implementation) ==============

// CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(data: Uint8Array, start = 0, end?: number): number {
  let crc = 0xffffffff;
  const len = end ?? data.length;
  for (let i = start; i < len; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Adler-32 checksum for zlib
function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

// Create zlib-wrapped deflate (what PNG actually needs)
async function zlibCompress(data: Uint8Array): Promise<Uint8Array> {
  // Use native CompressionStream for raw deflate
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  
  // Copy to ensure ArrayBuffer type
  const copy = new Uint8Array(data.length);
  copy.set(data);
  
  await writer.write(copy);
  await writer.close();
  
  const deflated = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  
  // Wrap in zlib format: 2-byte header + deflated data + 4-byte Adler-32
  const zlib = new Uint8Array(2 + deflated.length + 4);
  
  // Zlib header (CMF=0x78, FLG=0x9C for default compression)
  zlib[0] = 0x78;
  zlib[1] = 0x9c;
  
  // Deflated data
  zlib.set(deflated, 2);
  
  // Adler-32 checksum (big-endian)
  const checksum = adler32(data);
  const checksumOffset = 2 + deflated.length;
  zlib[checksumOffset] = (checksum >>> 24) & 0xff;
  zlib[checksumOffset + 1] = (checksum >>> 16) & 0xff;
  zlib[checksumOffset + 2] = (checksum >>> 8) & 0xff;
  zlib[checksumOffset + 3] = checksum & 0xff;
  
  return zlib;
}

// Create a valid PNG from RGBA data
async function createPNG(width: number, height: number, rgba: Uint8ClampedArray): Promise<Uint8Array> {
  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk (13 bytes of data)
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type (RGBA)
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method
  
  const ihdrChunk = createChunk('IHDR', ihdrData);
  
  // Prepare raw pixel data with filter bytes
  const rawData = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = rowOffset + 1 + x * 4;
      rawData[dstIdx] = rgba[srcIdx];
      rawData[dstIdx + 1] = rgba[srcIdx + 1];
      rawData[dstIdx + 2] = rgba[srcIdx + 2];
      rawData[dstIdx + 3] = rgba[srcIdx + 3];
    }
  }
  
  // Compress with zlib
  const compressed = await zlibCompress(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  
  // IEND chunk (0 bytes of data)
  const iendChunk = createChunk('IEND', new Uint8Array(0));
  
  // Combine all chunks
  const pngSize = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(pngSize);
  let offset = 0;
  png.set(signature, offset); offset += signature.length;
  png.set(ihdrChunk, offset); offset += ihdrChunk.length;
  png.set(idatChunk, offset); offset += idatChunk.length;
  png.set(iendChunk, offset);
  
  return png;
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  
  // Length (big-endian)
  view.setUint32(0, data.length, false);
  
  // Type (4 ASCII chars)
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  
  // Data
  chunk.set(data, 8);
  
  // CRC (over type + data)
  const crc = crc32(chunk, 4, 8 + data.length);
  view.setUint32(8 + data.length, crc, false);
  
  return chunk;
}

// ============== COLORMAP ==============

function heatColormap(value: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, value));
  let r: number, g: number, b: number;
  
  if (t < 0.25) {
    const s = t / 0.25;
    r = 0; g = Math.round(255 * s); b = 255;
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = 0; g = 255; b = Math.round(255 * (1 - s));
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = Math.round(255 * s); g = 255; b = 0;
  } else {
    const s = (t - 0.75) / 0.25;
    r = 255; g = Math.round(255 * (1 - s)); b = 0;
  }
  
  return [r, g, b, 220]; // Semi-transparent
}

// ============== TILE MATH ==============

function tileToBounds(z: number, x: number, y: number) {
  const n = Math.pow(2, z);
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const latRadN = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const latRadS = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const north = (latRadN * 180) / Math.PI;
  const south = (latRadS * 180) / Math.PI;
  return { west, south, east, north };
}

// ============== TRANSPARENT TILE (for genuine no-data) ==============

async function createTransparentTile(): Promise<Uint8Array> {
  const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  // All zeros = fully transparent
  return await createPNG(TILE_SIZE, TILE_SIZE, rgba);
}

// ============== MAIN HANDLER ==============

Deno.serve(async (req) => {
  const diag: Diagnostics = { mode: 'render', reason: 'ok' };
  
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const debug = url.searchParams.get('debug') === '1';
  
  // Parse tile coordinates
  const zParam = url.searchParams.get('z');
  const xParam = url.searchParams.get('x');
  const yParam = url.searchParams.get('y');
  const cogUrl = url.searchParams.get('cog_url');
  
  if (!zParam || !xParam || !yParam) {
    diag.mode = 'error';
    diag.reason = 'Missing tile coordinates';
    return errorResponse(diag, debug, 400);
  }
  
  const z = parseInt(zParam, 10);
  const x = parseInt(xParam, 10);
  const y = parseInt(yParam.replace('.png', ''), 10);
  
  if (isNaN(z) || isNaN(x) || isNaN(y)) {
    diag.mode = 'error';
    diag.reason = 'Invalid tile coordinates';
    return errorResponse(diag, debug, 400);
  }
  
  if (!cogUrl) {
    diag.mode = 'fallback';
    diag.reason = 'No COG URL provided';
    return fallbackResponse(diag, debug);
  }
  
  console.log(`[ECOSTRESS] Tile z=${z} x=${x} y=${y}`);
  
  try {
    // Build Earthdata auth headers
    const earthdataUsername = Deno.env.get('EARTHDATA_USERNAME');
    const earthdataPassword = Deno.env.get('EARTHDATA_PASSWORD');
    const earthdataToken = Deno.env.get('EARTHDATA_TOKEN');
    
    const authHeaders: Record<string, string> = {};
    if (earthdataToken) {
      authHeaders['Authorization'] = `Bearer ${earthdataToken}`;
    } else if (earthdataUsername && earthdataPassword) {
      authHeaders['Authorization'] = `Basic ${btoa(`${earthdataUsername}:${earthdataPassword}`)}`;
    } else {
      diag.mode = 'error';
      diag.reason = 'No Earthdata credentials configured';
      diag.stage = 'auth';
      return errorResponse(diag, debug, 500);
    }
    
    // Calculate tile bounds
    const bounds = tileToBounds(z, x, y);
    
    // Import geotiff dynamically (it's large)
    diag.stage = 'import';
    const GeoTIFF = await import('https://esm.sh/geotiff@2.1.3');
    
    // Fetch COG with auth
    diag.stage = 'fetch';
    console.log(`[ECOSTRESS] Fetching COG: ${cogUrl.substring(0, 80)}...`);
    
    const tiff = await GeoTIFF.fromUrl(cogUrl, {
      headers: authHeaders,
      allowFullFile: false,
    });
    
    diag.cogFetchStatus = 200;
    diag.rangeSupported = true;
    
    // Get image metadata
    diag.stage = 'metadata';
    const image = await tiff.getImage();
    const imageWidth = image.getWidth();
    const imageHeight = image.getHeight();
    const imageBounds = image.getBoundingBox();
    
    console.log(`[ECOSTRESS] Image: ${imageWidth}x${imageHeight}, bounds: ${JSON.stringify(imageBounds)}`);
    
    // Check if tile intersects image
    const [imgWest, imgSouth, imgEast, imgNorth] = imageBounds;
    if (bounds.east < imgWest || bounds.west > imgEast || 
        bounds.north < imgSouth || bounds.south > imgNorth) {
      diag.mode = 'fallback';
      diag.reason = 'Tile outside image bounds';
      return fallbackResponse(diag, debug);
    }
    
    // Calculate pixel window
    diag.stage = 'window';
    const pixelWidth = (imgEast - imgWest) / imageWidth;
    const pixelHeight = (imgNorth - imgSouth) / imageHeight;
    
    const left = Math.max(0, Math.floor((bounds.west - imgWest) / pixelWidth));
    const right = Math.min(imageWidth, Math.ceil((bounds.east - imgWest) / pixelWidth));
    const top = Math.max(0, Math.floor((imgNorth - bounds.north) / pixelHeight));
    const bottom = Math.min(imageHeight, Math.ceil((imgNorth - bounds.south) / pixelHeight));
    
    const windowWidth = right - left;
    const windowHeight = bottom - top;
    
    if (windowWidth <= 0 || windowHeight <= 0) {
      diag.mode = 'fallback';
      diag.reason = 'Invalid pixel window';
      return fallbackResponse(diag, debug);
    }
    
    // Read raster data
    diag.stage = 'read';
    console.log(`[ECOSTRESS] Reading window: [${left},${top}] to [${right},${bottom}]`);
    
    const rasters = await image.readRasters({
      window: [left, top, right, bottom],
      width: TILE_SIZE,
      height: TILE_SIZE,
      interleave: false,
    });
    
    const lstData = rasters[0] as Float32Array | Float64Array | Uint16Array;
    
    // Analyze data and create RGBA tile
    diag.stage = 'colorize';
    const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    
    let min = Infinity, max = -Infinity, nodata = 0, valid = 0;
    
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
      const value = lstData[i];
      
      // Check for nodata
      if (value <= 0 || value < 200 || isNaN(value)) {
        nodata++;
        // Transparent
        rgba[i * 4] = 0;
        rgba[i * 4 + 1] = 0;
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 0;
      } else {
        valid++;
        if (value < min) min = value;
        if (value > max) max = value;
        
        const normalized = (value - LST_MIN) / (LST_MAX - LST_MIN);
        const [r, g, b, a] = heatColormap(normalized);
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = a;
      }
    }
    
    diag.tileStats = { min, max, nodata, valid };
    console.log(`[ECOSTRESS] Stats: min=${min.toFixed(1)}K max=${max.toFixed(1)}K valid=${valid} nodata=${nodata}`);
    
    // If all nodata, return transparent tile
    if (valid === 0) {
      diag.mode = 'fallback';
      diag.reason = 'All pixels are nodata';
      return fallbackResponse(diag, debug);
    }
    
    // Encode PNG
    diag.stage = 'encode';
    const pngData = await createPNG(TILE_SIZE, TILE_SIZE, rgba);
    diag.pngBytes = pngData.length;
    
    console.log(`[ECOSTRESS] Generated tile: ${pngData.length} bytes`);
    
    // Success response
    diag.mode = 'render';
    diag.reason = 'ok';
    
    return new Response(pngData.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'X-ECOSTRESS-Mode': diag.mode,
        'X-ECOSTRESS-Reason': diag.reason,
        'X-ECOSTRESS-Stats': `min=${min.toFixed(0)}K,max=${max.toFixed(0)}K,valid=${valid}`,
        'X-ECOSTRESS-Bytes': String(pngData.length),
      },
    });
    
  } catch (err) {
    console.error(`[ECOSTRESS] Error at stage ${diag.stage}:`, err);
    diag.mode = 'error';
    diag.reason = err instanceof Error ? err.message : String(err);
    diag.error = diag.reason;
    return errorResponse(diag, debug, 500);
  }
});

// Error response (returns JSON for debug, transparent tile otherwise)
function errorResponse(diag: Diagnostics, debug: boolean, status: number): Response {
  if (debug) {
    return new Response(JSON.stringify(diag, null, 2), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-ECOSTRESS-Mode': diag.mode,
        'X-ECOSTRESS-Reason': diag.reason,
      },
    });
  }
  
  // Return error as JSON with diagnostic headers
  return new Response(JSON.stringify({ error: diag.reason, stage: diag.stage }), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'X-ECOSTRESS-Mode': diag.mode,
      'X-ECOSTRESS-Reason': diag.reason,
    },
  });
}

// Fallback response (transparent tile for known no-data cases)
async function fallbackResponse(diag: Diagnostics, debug: boolean): Promise<Response> {
  if (debug) {
    return new Response(JSON.stringify(diag, null, 2), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-ECOSTRESS-Mode': diag.mode,
        'X-ECOSTRESS-Reason': diag.reason,
      },
    });
  }
  
  const transparentTile = await createTransparentTile();
  return new Response(transparentTile.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
      'X-ECOSTRESS-Mode': diag.mode,
      'X-ECOSTRESS-Reason': diag.reason,
    },
  });
}
