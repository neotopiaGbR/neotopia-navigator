/**
 * ECOSTRESS Composite Utilities
 * 
 * Implements correct geographic alignment via windowed raster reading.
 * Each granule is cropped to the exact region bbox before stacking.
 */

import * as GeoTIFF from 'geotiff';
import { SUPABASE_URL } from '@/integrations/supabase/client';

// LST temperature range (Kelvin) for colorization - fixed scale
export const LST_MIN_K = 293; // 20°C
export const LST_MAX_K = 328; // 55°C

export type AggregationMethod = 'median' | 'mean' | 'min' | 'max' | 'p90' | 'p95';

export interface GranuleInput {
  cog_url: string;
  datetime: string;
  granule_id: string;
  granule_bounds?: [number, number, number, number];
}

export interface CompositeResult {
  imageData: ImageData;
  bounds: [number, number, number, number];
  stats: {
    min: number;
    max: number;
    mean: number; // Average temperature across all valid pixels
    validPixels: number;
    noDataPixels: number;
    totalPixels: number;
    aggregationMethod: AggregationMethod;
    granuleCount: number;
    successfulGranules: number;
  };
  metadata: {
    timeWindow: { from: string; to: string };
    acquisitionDates: string[];
    granuleIds: string[];
  };
}

// Output resolution
const OUTPUT_SIZE = 512;

/**
 * Convert lat/lon to pixel coordinates within a GeoTIFF
 * bbox: [minLon, minLat, maxLon, maxLat] in WGS84
 */
function latLonToPixel(
  lat: number, 
  lon: number, 
  bbox: [number, number, number, number], 
  width: number, 
  height: number
): { x: number; y: number } {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const xPct = (lon - minLon) / (maxLon - minLon);
  const yPct = (maxLat - lat) / (maxLat - minLat); // Y-axis inverted in images
  return {
    x: Math.floor(xPct * width),
    y: Math.floor(yPct * height)
  };
}

/**
 * NASA ECOSTRESS official color palette
 * Blue → Cyan → Green → Yellow → Orange → Red → Magenta
 */
export function kelvinToRGBA(kelvin: number): [number, number, number, number] {
  const range = LST_MAX_K - LST_MIN_K;
  const t = Math.max(0, Math.min(1, (kelvin - LST_MIN_K) / range));
  
  let r: number, g: number, b: number;
  
  if (t < 0.15) {
    // Blue to Cyan (20°C to ~25°C)
    const s = t / 0.15;
    r = 0;
    g = Math.round(s * 180);
    b = Math.round(180 + s * 75);
  } else if (t < 0.30) {
    // Cyan to Green (25°C to ~30°C)
    const s = (t - 0.15) / 0.15;
    r = 0;
    g = Math.round(180 + s * 75);
    b = Math.round(255 - s * 155);
  } else if (t < 0.45) {
    // Green to Yellow (30°C to ~37°C)
    const s = (t - 0.30) / 0.15;
    r = Math.round(s * 255);
    g = 255;
    b = Math.round(100 - s * 100);
  } else if (t < 0.60) {
    // Yellow to Orange (37°C to ~44°C)
    const s = (t - 0.45) / 0.15;
    r = 255;
    g = Math.round(255 - s * 80);
    b = 0;
  } else if (t < 0.80) {
    // Orange to Red (44°C to ~51°C)
    const s = (t - 0.60) / 0.20;
    r = 255;
    g = Math.round(175 - s * 140);
    b = 0;
  } else {
    // Red to Magenta (51°C to 55°C)
    const s = (t - 0.80) / 0.20;
    r = 255;
    g = Math.round(35 - s * 35);
    b = Math.round(s * 180);
  }
  
  return [r, g, b, 220];
}

/**
 * UTM to WGS84 conversion
 */
function utmToWgs84(easting: number, northing: number, zone: number, isNorth: boolean): [number, number] {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  
  const x = easting - 500000;
  const y = isNorth ? northing : northing - 10000000;
  
  const lon0 = (zone - 1) * 6 - 180 + 3;
  const lon0Rad = lon0 * Math.PI / 180;
  
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  
  const phi1 = mu 
    + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)
    + (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu);
  
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = ep2 * cosPhi1 * cosPhi1;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);
  
  const lat = phi1 - (N1 * tanPhi1 / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D * D * D * D * D * D / 720
  );
  
  const lon = lon0Rad + (
    D
    - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D / 120
  ) / cosPhi1;
  
  return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

function parseUtmZone(url: string, geoKeys: Record<string, any> | null): { zone: number; isNorth: boolean } | null {
  const mgrsMatch = url.match(/(\d{2})([C-X])([A-Z]{2})/i);
  if (mgrsMatch) {
    const zone = parseInt(mgrsMatch[1], 10);
    const latBand = mgrsMatch[2].toUpperCase();
    return { zone, isNorth: latBand >= 'N' };
  }
  
  if (geoKeys?.ProjectedCSTypeGeoKey) {
    const code = geoKeys.ProjectedCSTypeGeoKey;
    if (code >= 32601 && code <= 32660) return { zone: code - 32600, isNorth: true };
    if (code >= 32701 && code <= 32760) return { zone: code - 32700, isNorth: false };
  }
  
  return null;
}

function convertBoundsToWgs84(bounds: number[], utm: { zone: number; isNorth: boolean }): [number, number, number, number] {
  const [west, south, east, north] = bounds;
  const sw = utmToWgs84(west, south, utm.zone, utm.isNorth);
  const se = utmToWgs84(east, south, utm.zone, utm.isNorth);
  const nw = utmToWgs84(west, north, utm.zone, utm.isNorth);
  const ne = utmToWgs84(east, north, utm.zone, utm.isNorth);
  
  return [
    Math.min(sw[0], se[0], nw[0], ne[0]),
    Math.min(sw[1], se[1], nw[1], ne[1]),
    Math.max(sw[0], se[0], nw[0], ne[0]),
    Math.max(sw[1], se[1], nw[1], ne[1]),
  ];
}

/**
 * Get WGS84 bounds for a GeoTIFF image
 */
function getWgs84Bounds(
  granule: GranuleInput,
  image: GeoTIFF.GeoTIFFImage
): [number, number, number, number] | null {
  // Prefer API-provided bounds
  if (granule.granule_bounds && granule.granule_bounds.length === 4) {
    return granule.granule_bounds;
  }
  
  const rawBounds = image.getBoundingBox();
  const geoKeys = image.getGeoKeys();
  const utmInfo = parseUtmZone(granule.cog_url, geoKeys);
  
  if (utmInfo) {
    return convertBoundsToWgs84(rawBounds, utmInfo);
  }
  
  // Check if already WGS84
  if (Math.abs(rawBounds[0]) <= 180 && Math.abs(rawBounds[2]) <= 180) {
    return rawBounds as [number, number, number, number];
  }
  
  // Fallback: assume UTM zone 32N (Central Europe)
  return convertBoundsToWgs84(rawBounds, { zone: 32, isNorth: true });
}

/**
 * Aggregate pixel stack using specified method
 * 
 * STRICT P90 LOGIC:
 * - For stacks < 5: Use median (not enough data for meaningful percentile)
 * - For stacks >= 5: Use formula that GUARANTEES P90 < Max
 *   Index = min(length - 2, floor(length * 0.9))
 *   This ensures we never pick the absolute maximum value
 */
function aggregateStack(stack: number[], method: AggregationMethod): number {
  // Safety check: empty stack
  if (stack.length === 0) return NaN;
  
  // Single value: no aggregation possible
  if (stack.length === 1) return stack[0];
  
  // Sort ascending for all percentile operations
  const sorted = stack.slice().sort((a, b) => a - b);
  
  switch (method) {
    case 'max':
      return sorted[sorted.length - 1];
      
    case 'min':
      return sorted[0];
      
    case 'mean':
      return sorted.reduce((a, b) => a + b, 0) / sorted.length;
      
    case 'p90': {
      // STRICT P90: Must be lower than max when we have enough data
      if (sorted.length < 5) {
        // Not enough data for meaningful P90 → use median for stability
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
          ? (sorted[mid - 1] + sorted[mid]) / 2 
          : sorted[mid];
      }
      // Strict formula: guaranteed to be at least 1 below max
      // For [0..9] (10 items): floor(10 * 0.9) = 9, but min(9-2=8, 9) = 8
      // For [0..19] (20 items): floor(20 * 0.9) = 18, min(18, 18) = 18 (not max=19)
      const p90Index = Math.min(sorted.length - 2, Math.floor(sorted.length * 0.9));
      return sorted[p90Index];
    }
      
    case 'p95': {
      // Similar strict logic for P95
      if (sorted.length < 5) {
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
          ? (sorted[mid - 1] + sorted[mid]) / 2 
          : sorted[mid];
      }
      const p95Index = Math.min(sorted.length - 2, Math.floor(sorted.length * 0.95));
      return sorted[p95Index];
    }
      
    case 'median':
    default: {
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 
        ? (sorted[mid - 1] + sorted[mid]) / 2 
        : sorted[mid];
    }
  }
}

/**
 * Create a composite raster from multiple granules using windowed reading.
 * 
 * Algorithm:
 * 1. For each granule, calculate pixel window corresponding to regionBbox
 * 2. Read only that window, resampled to OUTPUT_SIZE x OUTPUT_SIZE
 * 3. Stack valid values per pixel across all granules
 * 4. Aggregate using specified method
 */
export async function createComposite(
  granules: GranuleInput[],
  regionBbox: [number, number, number, number],
  aggregationMethod: AggregationMethod = 'median',
  onProgress?: (loaded: number, total: number) => void
): Promise<CompositeResult | null> {
  if (granules.length === 0) return null;
  
  console.log(`[CompositeUtils] Creating ${aggregationMethod} composite from ${granules.length} granules`);
  console.log(`[CompositeUtils] Region bbox: [${regionBbox.join(', ')}]`);
  
  // Pixel stacks for each output pixel
  const pixelStacks: number[][] = new Array(OUTPUT_SIZE * OUTPUT_SIZE)
    .fill(null)
    .map(() => []);
  
  const acquisitionDates: string[] = [];
  const granuleIds: string[] = [];
  let successfulGranules = 0;
  
  // Process granules
  for (let i = 0; i < granules.length; i++) {
    const granule = granules[i];
    const proxyUrl = `${SUPABASE_URL}/functions/v1/ecostress-proxy?url=${encodeURIComponent(granule.cog_url)}`;
    
    try {
      const tiff = await GeoTIFF.fromUrl(proxyUrl, { allowFullFile: false });
      const image = await tiff.getImage();
      
      const imgWidth = image.getWidth();
      const imgHeight = image.getHeight();
      
      // Get WGS84 bounds
      const wgs84Bounds = getWgs84Bounds(granule, image);
      if (!wgs84Bounds) {
        console.warn(`[CompositeUtils] Could not determine bounds for ${granule.granule_id}`);
        continue;
      }
      
      // Calculate pixel window for the region bbox
      const topLeft = latLonToPixel(regionBbox[3], regionBbox[0], wgs84Bounds, imgWidth, imgHeight);
      const bottomRight = latLonToPixel(regionBbox[1], regionBbox[2], wgs84Bounds, imgWidth, imgHeight);
      
      // Clamp to image bounds
      const winX = Math.max(0, Math.min(imgWidth - 1, topLeft.x));
      const winY = Math.max(0, Math.min(imgHeight - 1, topLeft.y));
      const winX2 = Math.max(0, Math.min(imgWidth, bottomRight.x));
      const winY2 = Math.max(0, Math.min(imgHeight, bottomRight.y));
      const winW = winX2 - winX;
      const winH = winY2 - winY;
      
      if (winW <= 0 || winH <= 0) {
        console.log(`[CompositeUtils] Granule ${granule.granule_id} does not overlap region`);
        continue;
      }
      
      console.log(`[CompositeUtils] ${granule.granule_id}: window [${winX}, ${winY}, ${winW}x${winH}] from ${imgWidth}x${imgHeight}`);
      
      // Read the window, resampled to output size
      const rasters = await image.readRasters({
        window: [winX, winY, winX2, winY2],
        width: OUTPUT_SIZE,
        height: OUTPUT_SIZE,
        fillValue: 0,
        interleave: false,
      });
      
      const data = rasters[0] as Float32Array | Float64Array | Uint16Array;
      
      // Add valid values to stacks
      for (let j = 0; j < data.length; j++) {
        const value = data[j];
        // ECOSTRESS LST validity: 200-400K
        if (value > 200 && value < 400 && !isNaN(value)) {
          pixelStacks[j].push(value);
        }
      }
      
      successfulGranules++;
      acquisitionDates.push(granule.datetime);
      granuleIds.push(granule.granule_id);
      
    } catch (err) {
      console.warn(`[CompositeUtils] Failed to process ${granule.granule_id}:`, err);
    }
    
    onProgress?.(i + 1, granules.length);
  }
  
  if (successfulGranules === 0) {
    console.warn('[CompositeUtils] No granules successfully processed');
    return null;
  }
  
  console.log(`[CompositeUtils] Processed ${successfulGranules}/${granules.length} granules, aggregating with "${aggregationMethod}"...`);
  
  // Aggregate and colorize
  const imageData = new ImageData(OUTPUT_SIZE, OUTPUT_SIZE);
  const pixels = imageData.data;
  
  let validPixels = 0;
  let noDataPixels = 0;
  let minTemp = Infinity;
  let maxTemp = -Infinity;
  let tempSum = 0; // For calculating mean
  
  // Debug: sample distribution
  let pixelsWith2Plus = 0;
  let pixelsWith5Plus = 0; // Threshold for meaningful P90
  let maxStackSize = 0;
  let totalStackDepth = 0;
  let nonEmptyPixels = 0;
  
  for (let i = 0; i < pixelStacks.length; i++) {
    const stack = pixelStacks[i];
    const offset = i * 4;
    
    if (stack.length === 0) {
      noDataPixels++;
      pixels[offset + 3] = 0; // Transparent
      continue;
    }
    
    // Stack depth tracking
    nonEmptyPixels++;
    totalStackDepth += stack.length;
    if (stack.length >= 2) pixelsWith2Plus++;
    if (stack.length >= 5) pixelsWith5Plus++;
    maxStackSize = Math.max(maxStackSize, stack.length);
    
    const value = aggregateStack(stack, aggregationMethod);
    
    if (isNaN(value)) {
      noDataPixels++;
      pixels[offset + 3] = 0;
      continue;
    }
    
    validPixels++;
    minTemp = Math.min(minTemp, value);
    maxTemp = Math.max(maxTemp, value);
    tempSum += value; // Accumulate for mean
    
    const [r, g, b, a] = kelvinToRGBA(value);
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = a;
  }
  
  // Calculate mean temperature
  const meanTemp = validPixels > 0 ? tempSum / validPixels : 0;
  const averageStackDepth = nonEmptyPixels > 0 ? totalStackDepth / nonEmptyPixels : 0;
  
  const totalPixels = OUTPUT_SIZE * OUTPUT_SIZE;
  
  // IMPORTANT: Enhanced stack depth analysis for P90 vs Max differentiation
  console.log(`[CompositeUtils] ═══════════════════════════════════════════════════`);
  console.log(`[CompositeUtils] COMPOSITE STATS (${aggregationMethod.toUpperCase()})`);
  console.log(`[CompositeUtils] ───────────────────────────────────────────────────`);
  console.log(`[CompositeUtils] Valid pixels: ${validPixels}/${totalPixels} (${(validPixels/totalPixels*100).toFixed(1)}%)`);
  console.log(`[CompositeUtils] Temperature: ${(minTemp - 273.15).toFixed(1)}°C to ${(maxTemp - 273.15).toFixed(1)}°C (Ø ${(meanTemp - 273.15).toFixed(1)}°C)`);
  console.log(`[CompositeUtils] ───────────────────────────────────────────────────`);
  console.log(`[CompositeUtils] STACK DEPTH ANALYSIS (kritisch für P90 vs Max):`);
  console.log(`[CompositeUtils]   → Ø Stack Depth: ${averageStackDepth.toFixed(1)} Werte pro Pixel`);
  console.log(`[CompositeUtils]   → Pixels mit 2+ Samples: ${pixelsWith2Plus} (${(pixelsWith2Plus/totalPixels*100).toFixed(1)}%)`);
  console.log(`[CompositeUtils]   → Pixels mit 5+ Samples: ${pixelsWith5Plus} (${(pixelsWith5Plus/totalPixels*100).toFixed(1)}%) [für echtes P90]`);
  console.log(`[CompositeUtils]   → Max Stack Size: ${maxStackSize} Granules übereinander`);
  console.log(`[CompositeUtils]   → Granules erfolgreich: ${successfulGranules}/${granules.length}`);
  if (aggregationMethod === 'p90' && averageStackDepth < 5) {
    console.warn(`[CompositeUtils] ⚠️ Geringe Stack-Tiefe! P90 fällt auf Median zurück für stabilere Werte.`);
  }
  console.log(`[CompositeUtils] ═══════════════════════════════════════════════════`);
  
  const sortedDates = acquisitionDates.filter(d => d).sort();
  
  return {
    imageData,
    bounds: regionBbox, // Image now matches region exactly!
    stats: {
      min: minTemp,
      max: maxTemp,
      mean: meanTemp,
      validPixels,
      noDataPixels,
      totalPixels,
      aggregationMethod,
      granuleCount: granules.length,
      successfulGranules,
    },
    metadata: {
      timeWindow: {
        from: sortedDates[0] || '',
        to: sortedDates[sortedDates.length - 1] || '',
      },
      acquisitionDates,
      granuleIds,
    },
  };
}

/**
 * Convert ImageData to a data URL for BitmapLayer
 */
export function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
