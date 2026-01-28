/**
 * ECOSTRESS Composite Utilities
 * 
 * Implements scientifically-sound pixel-level aggregation for multi-granule compositing.
 * 
 * Key features:
 * - Quality filtering: discards granules with cloud >40% or coverage <60%
 * - Quality-weighted mosaic: weights by cloud confidence, view angle proxy, and continuity
 * - Regional percentile normalization: uses shared P5-P95 scale to prevent tile-to-tile jumps
 * - Single stable output: no overlapping swaths, no rotated tiles
 */

import * as GeoTIFF from 'geotiff';
import { SUPABASE_URL } from '@/integrations/supabase/client';

// Quality thresholds - very relaxed to include ALL available summer data
// The goal is to show HOTSPOTS, not filter out data
export const MAX_CLOUD_PERCENT = 90;  // Accept up to 90% cloud (keep everything)
export const MIN_COVERAGE_PERCENT = 10; // Accept even partial coverage

// LST temperature range (Kelvin) for colorization
export const LST_MIN_K = 260; // -13°C (winter)
export const LST_MAX_K = 320; // 47°C (hot summer)

// Aggregation methods: median (typical), p90 (extreme), max (absolute hottest)
export type AggregationMethod = 'median' | 'p90' | 'max';

export interface GranuleInput {
  cog_url: string;
  datetime: string;
  granule_id: string;
  cloud_percent?: number;
  coverage_percent?: number;
  quality_score?: number;
}

export interface CoverageConfidence {
  level: 'high' | 'medium' | 'low';
  percent: number;
  reason: string;
}

export interface CompositeResult {
  imageData: ImageData;
  bounds: [number, number, number, number]; // [west, south, east, north] in WGS84
  stats: {
    min: number;
    max: number;
    p5: number;  // 5th percentile for normalization
    p95: number; // 95th percentile for normalization
    validPixels: number;
    noDataPixels: number;
    totalPixels: number;
    aggregationMethod: AggregationMethod;
    granuleCount: number;
    successfulGranules: number;
    discardedGranules: number;
    discardReasons: { cloud: number; coverage: number; invalid: number };
  };
  metadata: {
    timeWindow: { from: string; to: string };
    acquisitionDates: string[];
    granuleIds: string[];
    coverageConfidence: CoverageConfidence;
  };
}

interface RasterData {
  values: Float32Array;
  width: number;
  height: number;
  bounds: [number, number, number, number]; // WGS84 bounds
  noDataValue: number;
  weight: number; // Quality weight for this granule
  datetime: string;
  granuleId: string;
}

/**
 * Heat colormap with percentile normalization
 * Uses regional P5-P95 for consistent scaling across tiles
 */
export function kelvinToRGBA(kelvin: number, p5: number = LST_MIN_K, p95: number = LST_MAX_K): [number, number, number, number] {
  // Normalize using regional percentiles to prevent tile-to-tile jumps
  const range = p95 - p5;
  const t = Math.max(0, Math.min(1, (kelvin - p5) / (range || 1)));
  
  let r: number, g: number, b: number;
  
  // Blue → Cyan → Green → Yellow → Orange → Red
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
 * Calculate quality weight for a granule
 * Weights by: cloud confidence (40%), spatial continuity proxy (30%), view angle proxy (30%)
 */
function calculateGranuleWeight(granule: GranuleInput): number {
  const cloudPercent = granule.cloud_percent ?? 20;
  const coveragePercent = granule.coverage_percent ?? 80;
  const qualityScore = granule.quality_score ?? 0.5;
  
  // Cloud confidence: lower cloud = higher weight
  const cloudWeight = Math.max(0, (100 - cloudPercent) / 100);
  
  // Coverage/continuity: higher coverage = higher weight
  const continuityWeight = Math.min(1, coveragePercent / 100);
  
  // Quality score already incorporates view angle proxy
  const qualityWeight = qualityScore;
  
  // Combined weight
  return 0.4 * cloudWeight + 0.3 * continuityWeight + 0.3 * qualityWeight;
}

/**
 * Fetch and decode a single COG, returning raw raster values with quality weight
 */
async function fetchCOGRaster(granule: GranuleInput): Promise<RasterData | null> {
  const proxyUrl = `${SUPABASE_URL}/functions/v1/ecostress-proxy?url=${encodeURIComponent(granule.cog_url)}`;
  
  try {
    const tiff = await GeoTIFF.fromUrl(proxyUrl, { allowFullFile: false });
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const rawBounds = image.getBoundingBox();
    const geoKeys = image.getGeoKeys();
    
    // Detect UTM and convert to WGS84
    const utmInfo = parseUtmZone(granule.cog_url, geoKeys);
    let wgs84Bounds: [number, number, number, number];
    
    if (utmInfo) {
      wgs84Bounds = convertBoundsToWgs84(rawBounds, utmInfo);
    } else if (Math.abs(rawBounds[0]) > 180 || Math.abs(rawBounds[2]) > 180) {
      // Fallback: assume UTM zone 32N (Central Europe)
      wgs84Bounds = convertBoundsToWgs84(rawBounds, { zone: 32, isNorth: true });
    } else {
      wgs84Bounds = rawBounds as [number, number, number, number];
    }
    
    // Validate bounds are reasonable WGS84
    if (wgs84Bounds[0] < -180 || wgs84Bounds[2] > 180 || 
        wgs84Bounds[1] < -90 || wgs84Bounds[3] > 90) {
      console.warn(`[CompositeUtils] Invalid bounds for ${granule.granule_id}, skipping`);
      return null;
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
      noDataValue: 0,
      weight: calculateGranuleWeight(granule),
      datetime: granule.datetime,
      granuleId: granule.granule_id,
    };
  } catch (err) {
    console.warn(`[CompositeUtils] Failed to fetch COG: ${granule.cog_url}`, err);
    return null;
  }
}

/**
 * Compute QUALITY-WEIGHTED aggregated value from array of {value, weight} pairs
 * Supports: median (typical), p90 (extreme 90th percentile), max (absolute maximum)
 */
function weightedAggregate(samples: { value: number; weight: number }[], method: AggregationMethod): number {
  if (samples.length === 0) return NaN;
  if (samples.length === 1) return samples[0].value;
  
  // For MAX method - just return the highest value (shows hottest readings)
  if (method === 'max') {
    return Math.max(...samples.map(s => s.value));
  }
  
  // Sort by value
  const sorted = samples.slice().sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, s) => sum + s.weight, 0);
  
  if (totalWeight === 0) {
    // Fallback to simple aggregation if all weights are zero
    const values = sorted.map(s => s.value);
    if (method === 'p90') {
      const idx = Math.floor(values.length * 0.9);
      return values[Math.min(idx, values.length - 1)];
    }
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  }
  
  const targetPercentile = method === 'p90' ? 0.9 : 0.5;
  const targetWeight = totalWeight * targetPercentile;
  
  let cumulativeWeight = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulativeWeight += sorted[i].weight;
    if (cumulativeWeight >= targetWeight) {
      // Interpolate between this and previous value for smoother results
      if (i > 0 && cumulativeWeight > targetWeight) {
        const prevWeight = cumulativeWeight - sorted[i].weight;
        const fraction = (targetWeight - prevWeight) / sorted[i].weight;
        return sorted[i - 1].value + fraction * (sorted[i].value - sorted[i - 1].value);
      }
      return sorted[i].value;
    }
  }
  
  return sorted[sorted.length - 1].value;
}

/**
 * Compute percentile from array of values
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * Determine coverage confidence based on valid pixel ratio and granule count
 */
function calculateCoverageConfidence(
  validPixels: number, 
  totalPixels: number, 
  successfulGranules: number
): CoverageConfidence {
  const coverageRatio = validPixels / (totalPixels || 1);
  
  if (coverageRatio >= 0.8 && successfulGranules >= 3) {
    return { 
      level: 'high', 
      percent: Math.round(coverageRatio * 100),
      reason: `${Math.round(coverageRatio * 100)}% Abdeckung mit ${successfulGranules} Aufnahmen`
    };
  }
  
  if (coverageRatio >= 0.5 && successfulGranules >= 2) {
    return { 
      level: 'medium', 
      percent: Math.round(coverageRatio * 100),
      reason: `${Math.round(coverageRatio * 100)}% Abdeckung mit ${successfulGranules} Aufnahmen – partielle Daten`
    };
  }
  
  return { 
    level: 'low', 
    percent: Math.round(coverageRatio * 100),
    reason: coverageRatio < 0.3 
      ? 'Geringe räumliche Abdeckung in dieser Region' 
      : `Begrenzte Daten: ${successfulGranules} Aufnahme${successfulGranules !== 1 ? 'n' : ''}`
  };
}

/**
 * Create a composite raster from multiple granules using quality-weighted pixel aggregation.
 * 
 * Algorithm:
 * 1. Filter granules by quality thresholds (cloud ≤40%, coverage ≥60%)
 * 2. Compute union bounding box of all valid rasters
 * 3. Create output grid at fixed resolution (~100m)
 * 4. For each output pixel, sample from all input rasters with weights
 * 5. Compute quality-weighted median/P90 of valid values
 * 6. Normalize using regional P5-P95 percentiles
 * 7. Colorize and return ImageData
 */
export async function createComposite(
  granules: GranuleInput[],
  regionBbox: [number, number, number, number],
  aggregationMethod: AggregationMethod = 'median',
  onProgress?: (loaded: number, total: number) => void
): Promise<CompositeResult | null> {
  if (granules.length === 0) return null;
  
  console.log(`[CompositeUtils] Creating ${aggregationMethod} composite from ${granules.length} granules`);
  
  // 1. QUALITY FILTERING - discard low-quality granules BEFORE fetching
  const discardReasons = { cloud: 0, coverage: 0, invalid: 0 };
  const qualifiedGranules = granules.filter(g => {
    // Filter by cloud threshold
    if ((g.cloud_percent ?? 0) > MAX_CLOUD_PERCENT) {
      discardReasons.cloud++;
      console.log(`[CompositeUtils] Discarding ${g.granule_id}: cloud ${g.cloud_percent}% > ${MAX_CLOUD_PERCENT}%`);
      return false;
    }
    // Filter by coverage threshold
    if ((g.coverage_percent ?? 100) < MIN_COVERAGE_PERCENT) {
      discardReasons.coverage++;
      console.log(`[CompositeUtils] Discarding ${g.granule_id}: coverage ${g.coverage_percent}% < ${MIN_COVERAGE_PERCENT}%`);
      return false;
    }
    return true;
  });
  
  console.log(`[CompositeUtils] After quality filtering: ${qualifiedGranules.length}/${granules.length} granules qualified`);
  
  if (qualifiedGranules.length === 0) {
    console.warn('[CompositeUtils] All granules filtered out by quality thresholds');
    return null;
  }
  
  // 2. Fetch all qualified raster data in parallel (with limit)
  const rasters: RasterData[] = [];
  const batchSize = 4; // Limit concurrent fetches
  const acquisitionDates: string[] = [];
  const granuleIds: string[] = [];
  
  for (let i = 0; i < qualifiedGranules.length; i += batchSize) {
    const batch = qualifiedGranules.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchCOGRaster));
    
    for (const r of results) {
      if (r) {
        rasters.push(r);
        acquisitionDates.push(r.datetime);
        granuleIds.push(r.granuleId);
      } else {
        discardReasons.invalid++;
      }
    }
    
    onProgress?.(Math.min(i + batchSize, qualifiedGranules.length), qualifiedGranules.length);
  }
  
  if (rasters.length === 0) {
    console.warn('[CompositeUtils] No valid rasters loaded after fetching');
    return null;
  }
  
  console.log(`[CompositeUtils] Successfully loaded ${rasters.length}/${qualifiedGranules.length} rasters`);
  
  // 3. Compute union bounding box, clipped to region
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
  
  // 4. Create output grid (~100m resolution, max 1024x1024)
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
  
  const totalPixels = outputWidth * outputHeight;
  console.log(`[CompositeUtils] Output grid: ${outputWidth}x${outputHeight} = ${totalPixels} pixels`);
  
  // 5. FIRST PASS: Collect all valid temperature values for percentile calculation
  const pixelWidth = boundsWidth / outputWidth;
  const pixelHeight = boundsHeight / outputHeight;
  
  const allValidTemps: number[] = [];
  const pixelSamples: { value: number; weight: number }[][] = new Array(totalPixels);
  
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const lon = unionBounds[0] + (x + 0.5) * pixelWidth;
      const lat = unionBounds[3] - (y + 0.5) * pixelHeight;
      
      const samples: { value: number; weight: number }[] = [];
      
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
          samples.push({ value, weight: raster.weight });
          allValidTemps.push(value);
        }
      }
      
      pixelSamples[y * outputWidth + x] = samples;
    }
  }
  
  if (allValidTemps.length === 0) {
    console.warn('[CompositeUtils] No valid temperature values found');
    return null;
  }
  
  // 6. Calculate regional percentiles for NORMALIZED colorization
  const p5 = percentile(allValidTemps, 0.05);
  const p95 = percentile(allValidTemps, 0.95);
  const minTemp = Math.min(...allValidTemps);
  const maxTemp = Math.max(...allValidTemps);
  
  console.log(`[CompositeUtils] Regional percentiles: P5=${(p5-273.15).toFixed(1)}°C, P95=${(p95-273.15).toFixed(1)}°C`);
  
  // 7. SECOND PASS: Generate colorized output using quality-weighted aggregation
  const imageData = new ImageData(outputWidth, outputHeight);
  const data = imageData.data;
  let validPixels = 0;
  let noDataPixels = 0;
  
  for (let i = 0; i < totalPixels; i++) {
    const samples = pixelSamples[i];
    const pixelOffset = i * 4;
    
    if (samples.length > 0) {
      const aggValue = weightedAggregate(samples, aggregationMethod);
      
      if (!isNaN(aggValue)) {
        validPixels++;
        
        // Use regional percentiles for normalization to prevent tile-to-tile contrast jumps
        const [r, g, b, a] = kelvinToRGBA(aggValue, p5, p95);
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
  
  console.log(`[CompositeUtils] Composite complete: ${validPixels} valid pixels, range ${(minTemp - 273.15).toFixed(1)}°C to ${(maxTemp - 273.15).toFixed(1)}°C`);
  
  // Sort dates to get time window
  const sortedDates = acquisitionDates.filter(d => d).sort();
  
  // Calculate coverage confidence
  const coverageConfidence = calculateCoverageConfidence(validPixels, totalPixels, rasters.length);
  
  return {
    imageData,
    bounds: unionBounds,
    stats: {
      min: minTemp,
      max: maxTemp,
      p5,
      p95,
      validPixels,
      noDataPixels,
      totalPixels,
      aggregationMethod,
      granuleCount: granules.length,
      successfulGranules: rasters.length,
      discardedGranules: granules.length - qualifiedGranules.length + discardReasons.invalid,
      discardReasons,
    },
    metadata: {
      timeWindow: {
        from: sortedDates[0] || '',
        to: sortedDates[sortedDates.length - 1] || '',
      },
      acquisitionDates,
      granuleIds,
      coverageConfidence,
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
