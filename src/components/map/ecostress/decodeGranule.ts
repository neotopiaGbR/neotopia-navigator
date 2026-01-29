/**
 * Decode a single ECOSTRESS granule to ImageBitmap
 * 
 * Renders the raw LST data without any aggregation.
 */

import * as GeoTIFF from 'geotiff';
import { SUPABASE_URL } from '@/integrations/supabase/client';
import { kelvinToRGBA, LST_MIN_K, LST_MAX_K } from './compositeUtils';

export interface DecodedGranule {
  image: ImageBitmap;
  bounds: [number, number, number, number];
  granuleId: string;
  datetime: string;
  stats: {
    validPixels: number;
    minTemp: number;
    maxTemp: number;
  };
}

const OUTPUT_SIZE = 512;

/**
 * UTM to WGS84 conversion (simplified)
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
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);
  
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

interface GranuleInput {
  cog_url: string;
  datetime: string;
  granule_id: string;
  granule_bounds?: [number, number, number, number];
}

/**
 * Decode a single granule and return colorized ImageBitmap
 */
export async function decodeGranule(
  granule: GranuleInput,
  regionBbox: [number, number, number, number]
): Promise<DecodedGranule | null> {
  const proxyUrl = `${SUPABASE_URL}/functions/v1/ecostress-proxy?url=${encodeURIComponent(granule.cog_url)}`;
  
  try {
    const tiff = await GeoTIFF.fromUrl(proxyUrl, { allowFullFile: false });
    const image = await tiff.getImage();
    
    const imgWidth = image.getWidth();
    const imgHeight = image.getHeight();
    
    // Get WGS84 bounds
    let wgs84Bounds: [number, number, number, number] | null = null;
    
    if (granule.granule_bounds && granule.granule_bounds.length === 4) {
      wgs84Bounds = granule.granule_bounds;
    } else {
      const rawBounds = image.getBoundingBox();
      const geoKeys = image.getGeoKeys();
      const utmInfo = parseUtmZone(granule.cog_url, geoKeys);
      
      if (utmInfo) {
        wgs84Bounds = convertBoundsToWgs84(rawBounds, utmInfo);
      } else if (Math.abs(rawBounds[0]) <= 180 && Math.abs(rawBounds[2]) <= 180) {
        wgs84Bounds = rawBounds as [number, number, number, number];
      } else {
        wgs84Bounds = convertBoundsToWgs84(rawBounds, { zone: 32, isNorth: true });
      }
    }
    
    if (!wgs84Bounds) {
      console.warn(`[decodeGranule] Could not determine bounds for ${granule.granule_id}`);
      return null;
    }
    
    // Calculate pixel window for region
    const latLonToPixel = (lat: number, lon: number) => {
      const [minLon, minLat, maxLon, maxLat] = wgs84Bounds!;
      const xPct = (lon - minLon) / (maxLon - minLon);
      const yPct = (maxLat - lat) / (maxLat - minLat);
      return {
        x: Math.floor(xPct * imgWidth),
        y: Math.floor(yPct * imgHeight)
      };
    };
    
    const topLeft = latLonToPixel(regionBbox[3], regionBbox[0]);
    const bottomRight = latLonToPixel(regionBbox[1], regionBbox[2]);
    
    const winX = Math.max(0, Math.min(imgWidth - 1, topLeft.x));
    const winY = Math.max(0, Math.min(imgHeight - 1, topLeft.y));
    const winX2 = Math.max(0, Math.min(imgWidth, bottomRight.x));
    const winY2 = Math.max(0, Math.min(imgHeight, bottomRight.y));
    const winW = winX2 - winX;
    const winH = winY2 - winY;
    
    if (winW <= 0 || winH <= 0) {
      console.log(`[decodeGranule] ${granule.granule_id} does not overlap region`);
      return null;
    }
    
    // Read window resampled to output size
    const rasters = await image.readRasters({
      window: [winX, winY, winX2, winY2],
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      fillValue: 0,
      interleave: false,
    });
    
    const data = rasters[0] as Float32Array | Float64Array | Uint16Array;
    
    // Colorize
    const imageData = new ImageData(OUTPUT_SIZE, OUTPUT_SIZE);
    const pixels = imageData.data;
    
    let validPixels = 0;
    let minTemp = Infinity;
    let maxTemp = -Infinity;
    
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      const offset = i * 4;
      
      if (value > 200 && value < 400 && !isNaN(value)) {
        validPixels++;
        minTemp = Math.min(minTemp, value);
        maxTemp = Math.max(maxTemp, value);
        
        const [r, g, b, a] = kelvinToRGBA(value);
        pixels[offset] = r;
        pixels[offset + 1] = g;
        pixels[offset + 2] = b;
        pixels[offset + 3] = a;
      } else {
        pixels[offset + 3] = 0; // Transparent
      }
    }
    
    if (validPixels === 0) {
      console.log(`[decodeGranule] ${granule.granule_id} has no valid pixels`);
      return null;
    }
    
    // Convert to ImageBitmap
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.putImageData(imageData, 0, 0);
    
    const bitmap = await createImageBitmap(canvas, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    
    console.log(`[decodeGranule] ${granule.granule_id}: ${validPixels} pixels, ${(minTemp - 273.15).toFixed(1)}°C - ${(maxTemp - 273.15).toFixed(1)}°C`);
    
    return {
      image: bitmap,
      bounds: regionBbox,
      granuleId: granule.granule_id,
      datetime: granule.datetime,
      stats: {
        validPixels,
        minTemp,
        maxTemp,
      },
    };
  } catch (err) {
    console.warn(`[decodeGranule] Failed ${granule.granule_id}:`, err);
    return null;
  }
}
