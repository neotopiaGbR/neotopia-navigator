/**
 * ECOSTRESS Composite Utilities
 * 
 * Implements pixel-level aggregation (median/P90) for multi-granule compositing.
 * This creates a stable, unified heat map from multiple orbital swaths.
 */

import * as GeoTIFF from 'geotiff';
import { SUPABASE_URL } from '@/integrations/supabase/client';

// LST temperature range (Kelvin) for colorization
export const LST_MIN_K = 260; // -13°C (winter)
export const LST_MAX_K = 320; // 47°C (hot summer)

export type AggregationMethod = 'median' | 'p90';

export interface GranuleInput {
  cog_url: string;
  datetime: string;
  granule_id: string;
}

export interface CompositeResult {
  imageData: ImageData;
  bounds: [number, number, number, number]; // [west, south, east, north] in WGS84
  stats: {
    min: number;
    max: number;
    validPixels: number;
    noDataPixels: number;
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

interface RasterData {
  values: Float32Array;
  width: number;
  height: number;
  bounds: [number, number, number, number]; // WGS84 bounds
  noDataValue: number;
}

/**
 * Heat colormap: blue → cyan → green → yellow → orange → red
 */
export function kelvinToRGBA(kelvin: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (kelvin - LST_MIN_K) / (LST_MAX_K - LST_MIN_K)));
  let r: number, g: number, b: number;
  
  if (t < 0.2) {
    r = 0; g = Math.round(255 * (t / 0.2)); b = 255;
  } else if (t < 0.4) {
    const s = (t - 0.2) / 0.2;
    r = 0; g = 255; b = Math.round(255 * (1 - s));
  } else if (t < 0.6) {
    const s = (t - 0.4) / 0.2;
    r = Math.round(255 * s); g = 255; b = 0;
  } else if (t < 0.8) {
    const s = (t - 0.6) / 0.2;
    r = 255; g = Math.round(255 * (1 - s * 0.5)); b = 0;
  } else {
    const s = (t - 0.8) / 0.2;
    r = 255; g = Math.round(128 * (1 - s)); b = 0;
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
  const e = Math.sqrt(e2);
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
  
  return [lon * 180 / Math.PI, (isNorth ? lat : -lat) * 180 / Math.PI];
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
 * Fetch and decode a single COG, returning raw raster values
 */
async function fetchCOGRaster(cogUrl: string): Promise<RasterData | null> {
  const proxyUrl = `${SUPABASE_URL}/functions/v1/ecostress-proxy?url=${encodeURIComponent(cogUrl)}`;
  
  try {
    const tiff = await GeoTIFF.fromUrl(proxyUrl, { allowFullFile: false });
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const rawBounds = image.getBoundingBox();
    const geoKeys = image.getGeoKeys();
    
    // Detect UTM and convert to WGS84
    const utmInfo = parseUtmZone(cogUrl, geoKeys);
    let wgs84Bounds: [number, number, number, number];
    
    if (utmInfo) {
      wgs84Bounds = convertBoundsToWgs84(rawBounds, utmInfo);
    } else if (Math.abs(rawBounds[0]) > 180 || Math.abs(rawBounds[2]) > 180) {
      // Fallback: assume UTM zone 32N (Berlin area)
      wgs84Bounds = convertBoundsToWgs84(rawBounds, { zone: 32, isNorth: true });
    } else {
      wgs84Bounds = rawBounds as [number, number, number, number];
    }
    
    // Read at reduced resolution for performance
    const targetWidth = Math.min(width, 512);
    const targetHeight = Math.round((targetWidth / width) * height);
    
    const rasters = await image.readRasters({
      width: targetWidth,
      height: targetHeight,
      interleave: false,
    });
    
    const data = rasters[0] as Float32Array | Float64Array | Uint16Array;
    const values = new Float32Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      values[i] = data[i];
    }
    
    return {
      values,
      width: targetWidth,
      height: targetHeight,
      bounds: wgs84Bounds,
      noDataValue: 0, // ECOSTRESS uses 0 as nodata
    };
  } catch (err) {
    console.warn(`[CompositeUtils] Failed to fetch COG: ${cogUrl}`, err);
    return null;
  }
}

/**
 * Compute aggregated value (median or P90) from array of valid values
 */
function aggregate(values: number[], method: AggregationMethod): number {
  if (values.length === 0) return NaN;
  if (values.length === 1) return values[0];
  
  const sorted = values.slice().sort((a, b) => a - b);
  
  if (method === 'p90') {
    const idx = Math.floor(sorted.length * 0.9);
    return sorted[Math.min(idx, sorted.length - 1)];
  }
  
  // Median
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Create a composite raster from multiple granules using pixel aggregation.
 * 
 * Algorithm:
 * 1. Compute union bounding box of all input rasters
 * 2. Create output grid at fixed resolution (~100m)
 * 3. For each output pixel, sample from all input rasters
 * 4. Compute median/P90 of valid values
 * 5. Colorize and return ImageData
 */
export async function createComposite(
  granules: GranuleInput[],
  regionBbox: [number, number, number, number],
  aggregationMethod: AggregationMethod = 'median',
  onProgress?: (loaded: number, total: number) => void
): Promise<CompositeResult | null> {
  if (granules.length === 0) return null;
  
  console.log(`[CompositeUtils] Creating ${aggregationMethod} composite from ${granules.length} granules`);
  
  // 1. Fetch all raster data in parallel (with limit)
  const rasters: (RasterData & { datetime: string; granuleId: string })[] = [];
  const batchSize = 4; // Limit concurrent fetches
  const acquisitionDates: string[] = [];
  const granuleIds: string[] = [];
  
  for (let i = 0; i < granules.length; i += batchSize) {
    const batch = granules.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (g) => {
        const raster = await fetchCOGRaster(g.cog_url);
        if (raster) {
          return { ...raster, datetime: g.datetime, granuleId: g.granule_id };
        }
        return null;
      })
    );
    
    for (const r of results) {
      if (r) {
        rasters.push(r);
        acquisitionDates.push(r.datetime);
        granuleIds.push(r.granuleId);
      }
    }
    
    onProgress?.(Math.min(i + batchSize, granules.length), granules.length);
  }
  
  if (rasters.length === 0) {
    console.warn('[CompositeUtils] No valid rasters loaded');
    return null;
  }
  
  console.log(`[CompositeUtils] Successfully loaded ${rasters.length}/${granules.length} rasters`);
  
  // 2. Compute union bounding box, clipped to region
  let unionBounds: [number, number, number, number] = [
    Math.max(regionBbox[0], Math.min(...rasters.map(r => r.bounds[0]))),
    Math.max(regionBbox[1], Math.min(...rasters.map(r => r.bounds[1]))),
    Math.min(regionBbox[2], Math.max(...rasters.map(r => r.bounds[2]))),
    Math.min(regionBbox[3], Math.max(...rasters.map(r => r.bounds[3]))),
  ];
  
  // Validate bounds
  if (unionBounds[0] >= unionBounds[2] || unionBounds[1] >= unionBounds[3]) {
    console.warn('[CompositeUtils] No overlap between rasters and region');
    return null;
  }
  
  // 3. Create output grid (~100m resolution, max 1024x1024)
  const boundsWidth = unionBounds[2] - unionBounds[0];
  const boundsHeight = unionBounds[3] - unionBounds[1];
  const aspectRatio = boundsWidth / boundsHeight;
  
  // Aim for ~100m pixels (0.001 degrees ≈ 100m at mid-latitudes)
  const targetRes = 0.001;
  let outputWidth = Math.ceil(boundsWidth / targetRes);
  let outputHeight = Math.ceil(boundsHeight / targetRes);
  
  // Cap at 1024 for performance
  if (outputWidth > 1024) {
    outputWidth = 1024;
    outputHeight = Math.round(outputWidth / aspectRatio);
  }
  if (outputHeight > 1024) {
    outputHeight = 1024;
    outputWidth = Math.round(outputHeight * aspectRatio);
  }
  
  outputWidth = Math.max(64, outputWidth);
  outputHeight = Math.max(64, outputHeight);
  
  console.log(`[CompositeUtils] Output grid: ${outputWidth}x${outputHeight}`);
  
  // 4. Aggregate pixels
  const pixelWidth = boundsWidth / outputWidth;
  const pixelHeight = boundsHeight / outputHeight;
  
  const imageData = new ImageData(outputWidth, outputHeight);
  const data = imageData.data;
  
  let minTemp = Infinity;
  let maxTemp = -Infinity;
  let validPixels = 0;
  let noDataPixels = 0;
  
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      // Geographic coordinates for this output pixel center
      const lon = unionBounds[0] + (x + 0.5) * pixelWidth;
      const lat = unionBounds[3] - (y + 0.5) * pixelHeight; // Y is inverted
      
      // Sample from all rasters at this location
      const samples: number[] = [];
      
      for (const raster of rasters) {
        // Check if point is within raster bounds
        if (lon < raster.bounds[0] || lon > raster.bounds[2] ||
            lat < raster.bounds[1] || lat > raster.bounds[3]) {
          continue;
        }
        
        // Convert to pixel coordinates in source raster
        const srcX = Math.floor(((lon - raster.bounds[0]) / (raster.bounds[2] - raster.bounds[0])) * raster.width);
        const srcY = Math.floor(((raster.bounds[3] - lat) / (raster.bounds[3] - raster.bounds[1])) * raster.height);
        
        if (srcX < 0 || srcX >= raster.width || srcY < 0 || srcY >= raster.height) {
          continue;
        }
        
        const value = raster.values[srcY * raster.width + srcX];
        
        // ECOSTRESS LST validity check (200-400K is valid temperature range)
        if (value > 200 && value < 400 && !isNaN(value)) {
          samples.push(value);
        }
      }
      
      const pixelOffset = (y * outputWidth + x) * 4;
      
      if (samples.length > 0) {
        const aggValue = aggregate(samples, aggregationMethod);
        
        if (!isNaN(aggValue)) {
          validPixels++;
          if (aggValue < minTemp) minTemp = aggValue;
          if (aggValue > maxTemp) maxTemp = aggValue;
          
          const [r, g, b, a] = kelvinToRGBA(aggValue);
          data[pixelOffset] = r;
          data[pixelOffset + 1] = g;
          data[pixelOffset + 2] = b;
          data[pixelOffset + 3] = a;
        } else {
          noDataPixels++;
          data[pixelOffset + 3] = 0; // Transparent
        }
      } else {
        noDataPixels++;
        data[pixelOffset + 3] = 0; // Transparent
      }
    }
  }
  
  if (validPixels === 0) {
    console.warn('[CompositeUtils] Composite contains no valid pixels');
    return null;
  }
  
  console.log(`[CompositeUtils] Composite complete: ${validPixels} valid pixels, ${(minTemp - 273.15).toFixed(1)}°C to ${(maxTemp - 273.15).toFixed(1)}°C`);
  
  // Sort dates to get time window
  const sortedDates = acquisitionDates.filter(d => d).sort();
  
  return {
    imageData,
    bounds: unionBounds,
    stats: {
      min: minTemp,
      max: maxTemp,
      validPixels,
      noDataPixels,
      aggregationMethod,
      granuleCount: granules.length,
      successfulGranules: rasters.length,
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
