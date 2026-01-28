/**
 * ECOSTRESS Heat Overlay using deck.gl + geotiff.js
 * 
 * Renders NASA ECOSTRESS Land Surface Temperature COGs client-side.
 * Uses ecostress-proxy Edge Function for authenticated Range-request access.
 * 
 * Key fix: COGs are in UTM projection, must convert bounds to WGS84 for deck.gl
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer } from '@deck.gl/layers';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { SUPABASE_URL } from '@/integrations/supabase/client';
import * as GeoTIFF from 'geotiff';

interface EcostressOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  cogUrl: string | null;
  onRenderStatus?: (status: 'loading' | 'rendered' | 'error', message?: string) => void;
  onDebugInfo?: (info: DebugInfo) => void;
}

export interface DebugInfo {
  proxyUrl: string;
  proxyStatus: number | null;
  deckCanvasExists: boolean;
  rasterBounds: [number, number, number, number] | null;
  rawBounds: number[] | null;
  crs: string | null;
  minPixel: number | null;
  maxPixel: number | null;
  validPixels: number;
  noDataPixels: number;
  imageWidth: number;
  imageHeight: number;
}

interface RenderResult {
  imageData: ImageData;
  bounds: [number, number, number, number]; // [west, south, east, north] in WGS84
  rawBounds: number[];
  crs: string | null;
  stats: { min: number; max: number; validPixels: number; noDataPixels: number };
}

// LST temperature range (Kelvin) for colorization
const LST_MIN_K = 260; // -13°C (winter)
const LST_MAX_K = 320; // 47°C (hot summer)

/**
 * Heat colormap: blue → cyan → green → yellow → orange → red
 */
function kelvinToRGBA(kelvin: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (kelvin - LST_MIN_K) / (LST_MAX_K - LST_MIN_K)));
  let r: number, g: number, b: number;
  
  if (t < 0.2) {
    // Blue to Cyan
    const s = t / 0.2;
    r = 0; g = Math.round(255 * s); b = 255;
  } else if (t < 0.4) {
    // Cyan to Green
    const s = (t - 0.2) / 0.2;
    r = 0; g = 255; b = Math.round(255 * (1 - s));
  } else if (t < 0.6) {
    // Green to Yellow
    const s = (t - 0.4) / 0.2;
    r = Math.round(255 * s); g = 255; b = 0;
  } else if (t < 0.8) {
    // Yellow to Orange
    const s = (t - 0.6) / 0.2;
    r = 255; g = Math.round(255 * (1 - s * 0.5)); b = 0;
  } else {
    // Orange to Red
    const s = (t - 0.8) / 0.2;
    r = 255; g = Math.round(128 * (1 - s)); b = 0;
  }
  
  return [r, g, b, 220]; // High opacity for visibility
}

/**
 * Convert UTM coordinates to WGS84 (lat/lon)
 * Uses simplified formula - accurate enough for visualization
 */
function utmToWgs84(easting: number, northing: number, zone: number, isNorthernHemisphere: boolean): [number, number] {
  // WGS84 parameters
  const a = 6378137; // semi-major axis
  const e = 0.0818192; // eccentricity
  const e1sq = 0.006739497;
  const k0 = 0.9996; // scale factor
  
  const arc = northing / k0;
  const mu = arc / (a * (1 - Math.pow(e, 2) / 4 - 3 * Math.pow(e, 4) / 64 - 5 * Math.pow(e, 6) / 256));
  
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));
  const ca = 3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32;
  const cb = 21 * Math.pow(e1, 2) / 16 - 55 * Math.pow(e1, 4) / 32;
  const cc = 151 * Math.pow(e1, 3) / 96;
  const cd = 1097 * Math.pow(e1, 4) / 512;
  
  const phi1 = mu + ca * Math.sin(2 * mu) + cb * Math.sin(4 * mu) + cc * Math.sin(6 * mu) + cd * Math.sin(8 * mu);
  
  const n0 = a / Math.sqrt(1 - Math.pow(e * Math.sin(phi1), 2));
  const r0 = a * (1 - e * e) / Math.pow(1 - Math.pow(e * Math.sin(phi1), 2), 1.5);
  const fact1 = n0 * Math.tan(phi1) / r0;
  
  const a1 = 500000 - easting;
  const dd0 = a1 / (n0 * k0);
  const fact2 = dd0 * dd0 / 2;
  const t0 = Math.pow(Math.tan(phi1), 2);
  const q0 = e1sq * Math.pow(Math.cos(phi1), 2);
  const fact3 = (5 + 3 * t0 + 10 * q0 - 4 * q0 * q0 - 9 * e1sq) * Math.pow(dd0, 4) / 24;
  const fact4 = (61 + 90 * t0 + 298 * q0 + 45 * t0 * t0 - 252 * e1sq - 3 * q0 * q0) * Math.pow(dd0, 6) / 720;
  
  const lof1 = a1 / (n0 * k0);
  const lof2 = (1 + 2 * t0 + q0) * Math.pow(dd0, 3) / 6;
  const lof3 = (5 - 2 * q0 + 28 * t0 - 3 * Math.pow(q0, 2) + 8 * e1sq + 24 * Math.pow(t0, 2)) * Math.pow(dd0, 5) / 120;
  const _a2 = (lof1 - lof2 + lof3) / Math.cos(phi1);
  const _a3 = _a2 * 180 / Math.PI;
  
  let lat = 180 * (phi1 - fact1 * (fact2 + fact3 + fact4)) / Math.PI;
  
  if (!isNorthernHemisphere) {
    lat = -lat;
  }
  
  const lon = ((zone > 0 ? (6 * zone - 183) : 3) - _a3);
  
  return [lon, lat];
}

/**
 * Parse UTM zone from GeoTIFF metadata or MGRS tile ID in URL
 */
function parseUtmZone(url: string, geoKeys: Record<string, any> | null): { zone: number; isNorth: boolean } | null {
  // Try to extract from MGRS tile ID in URL (e.g., 32UQC)
  const mgrsMatch = url.match(/(\d{2})([C-X])([A-Z]{2})/i);
  if (mgrsMatch) {
    const zone = parseInt(mgrsMatch[1], 10);
    const latBand = mgrsMatch[2].toUpperCase();
    const isNorth = latBand >= 'N'; // N and above are Northern hemisphere
    return { zone, isNorth };
  }
  
  // Try from GeoTIFF geo keys
  if (geoKeys) {
    const projectedCSType = geoKeys.ProjectedCSTypeGeoKey;
    if (projectedCSType) {
      // EPSG codes: 326xx = WGS84 UTM North, 327xx = WGS84 UTM South
      if (projectedCSType >= 32601 && projectedCSType <= 32660) {
        return { zone: projectedCSType - 32600, isNorth: true };
      }
      if (projectedCSType >= 32701 && projectedCSType <= 32760) {
        return { zone: projectedCSType - 32700, isNorth: false };
      }
    }
  }
  
  return null;
}

/**
 * Convert projected bounds to WGS84
 */
function convertBoundsToWgs84(
  bounds: number[], // [west, south, east, north] in projected CRS
  utmInfo: { zone: number; isNorth: boolean }
): [number, number, number, number] {
  const [west, south, east, north] = bounds;
  
  // Convert all four corners and get extent
  const sw = utmToWgs84(west, south, utmInfo.zone, utmInfo.isNorth);
  const se = utmToWgs84(east, south, utmInfo.zone, utmInfo.isNorth);
  const nw = utmToWgs84(west, north, utmInfo.zone, utmInfo.isNorth);
  const ne = utmToWgs84(east, north, utmInfo.zone, utmInfo.isNorth);
  
  // Get bounding box of transformed corners
  const minLon = Math.min(sw[0], se[0], nw[0], ne[0]);
  const maxLon = Math.max(sw[0], se[0], nw[0], ne[0]);
  const minLat = Math.min(sw[1], se[1], nw[1], ne[1]);
  const maxLat = Math.max(sw[1], se[1], nw[1], ne[1]);
  
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Fetch and decode a COG via the proxy, render to ImageData
 */
async function fetchAndRenderCOG(cogUrl: string): Promise<RenderResult> {
  const proxyUrl = `${SUPABASE_URL}/functions/v1/ecostress-proxy?url=${encodeURIComponent(cogUrl)}`;
  
  console.log('[EcostressOverlay] Fetching COG via proxy:', proxyUrl.substring(0, 100));
  
  // Use geotiff.js with our proxy URL
  const tiff = await GeoTIFF.fromUrl(proxyUrl, {
    allowFullFile: false, // Enable range requests for efficiency
  });
  
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const rawBounds = image.getBoundingBox(); // [west, south, east, north] in native CRS
  
  // Get geo keys for CRS info
  const geoKeys = image.getGeoKeys();
  const projectedCSType = geoKeys?.ProjectedCSTypeGeoKey;
  const crs = projectedCSType ? `EPSG:${projectedCSType}` : null;
  
  console.log('[EcostressOverlay] COG metadata:', { 
    width, 
    height, 
    rawBounds, 
    crs,
    geoKeys: JSON.stringify(geoKeys).substring(0, 200)
  });
  
  // Detect UTM zone and convert bounds to WGS84
  const utmInfo = parseUtmZone(cogUrl, geoKeys);
  let wgs84Bounds: [number, number, number, number];
  
  if (utmInfo) {
    wgs84Bounds = convertBoundsToWgs84(rawBounds, utmInfo);
    console.log('[EcostressOverlay] Converted UTM to WGS84:', {
      utmZone: utmInfo.zone,
      isNorth: utmInfo.isNorth,
      rawBounds,
      wgs84Bounds,
    });
  } else {
    // Assume bounds are already in WGS84 if no UTM info found
    // Check if values look like lat/lon (small numbers) vs projected (large numbers)
    if (Math.abs(rawBounds[0]) > 180 || Math.abs(rawBounds[2]) > 180) {
      console.warn('[EcostressOverlay] Unknown CRS with large coords, assuming UTM zone 32N (Berlin area)');
      wgs84Bounds = convertBoundsToWgs84(rawBounds, { zone: 32, isNorth: true });
    } else {
      wgs84Bounds = rawBounds as [number, number, number, number];
    }
  }
  
  // Validate WGS84 bounds
  if (wgs84Bounds[0] < -180 || wgs84Bounds[2] > 180 || wgs84Bounds[1] < -90 || wgs84Bounds[3] > 90) {
    console.error('[EcostressOverlay] Invalid WGS84 bounds:', wgs84Bounds);
    throw new Error('Failed to convert raster bounds to valid WGS84 coordinates');
  }
  
  // Read raster data at reduced resolution for performance
  const targetWidth = Math.min(width, 1024);
  const targetHeight = Math.round((targetWidth / width) * height);
  
  const rasters = await image.readRasters({
    width: targetWidth,
    height: targetHeight,
    interleave: false,
  });
  
  const lstData = rasters[0] as Float32Array | Float64Array | Uint16Array;
  
  // First pass: find actual data range
  let min = Infinity;
  let max = -Infinity;
  let validPixels = 0;
  let noDataPixels = 0;
  
  for (let i = 0; i < lstData.length; i++) {
    const value = lstData[i];
    // ECOSTRESS LST uses 0 or very small values as nodata
    // Valid Kelvin temps are roughly 200-350K
    if (value <= 0 || value < 200 || value > 400 || isNaN(value)) {
      noDataPixels++;
    } else {
      validPixels++;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  
  console.log('[EcostressOverlay] Data range analysis:', {
    dimensions: `${targetWidth}x${targetHeight}`,
    validPixels,
    noDataPixels,
    minK: min.toFixed(2),
    maxK: max.toFixed(2),
    minC: (min - 273.15).toFixed(1),
    maxC: (max - 273.15).toFixed(1),
  });
  
  if (validPixels === 0) {
    throw new Error(`COG contains no valid LST data. All ${noDataPixels} pixels are nodata.`);
  }
  
  // Create ImageData with colorized pixels
  const imageData = new ImageData(targetWidth, targetHeight);
  const data = imageData.data;
  
  for (let i = 0; i < lstData.length; i++) {
    const value = lstData[i];
    const pixelOffset = i * 4;
    
    // Check for nodata
    if (value <= 0 || value < 200 || value > 400 || isNaN(value)) {
      // Transparent pixel
      data[pixelOffset] = 0;
      data[pixelOffset + 1] = 0;
      data[pixelOffset + 2] = 0;
      data[pixelOffset + 3] = 0;
    } else {
      const [r, g, b, a] = kelvinToRGBA(value);
      data[pixelOffset] = r;
      data[pixelOffset + 1] = g;
      data[pixelOffset + 2] = b;
      data[pixelOffset + 3] = a;
    }
  }
  
  console.log('[EcostressOverlay] Rendered COG:', {
    dimensions: `${targetWidth}x${targetHeight}`,
    validPixels,
    noDataPixels,
    tempRange: `${(min - 273.15).toFixed(1)}°C to ${(max - 273.15).toFixed(1)}°C`,
    wgs84Bounds,
  });
  
  return {
    imageData,
    bounds: wgs84Bounds,
    rawBounds,
    crs,
    stats: { min, max, validPixels, noDataPixels },
  };
}

/**
 * Convert ImageData to a data URL for BitmapLayer
 */
function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function EcostressOverlay({ 
  map, 
  visible, 
  opacity = 0.7, 
  cogUrl,
  onRenderStatus,
  onDebugInfo,
}: EcostressOverlayProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [renderState, setRenderState] = useState<{
    status: 'idle' | 'loading' | 'rendered' | 'error';
    message?: string;
    stats?: RenderResult['stats'];
  }>({ status: 'idle' });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Fetch and render COG when cogUrl changes
  useEffect(() => {
    if (!visible || !cogUrl) {
      setRenderState({ status: 'idle' });
      setImageUrl(null);
      setBounds(null);
      setDebugInfo(null);
      return;
    }

    let cancelled = false;
    const proxyUrl = `${SUPABASE_URL}/functions/v1/ecostress-proxy?url=${encodeURIComponent(cogUrl)}`;

    async function loadCOG() {
      setRenderState({ status: 'loading', message: 'Lade ECOSTRESS-Daten...' });
      onRenderStatus?.('loading', 'Lade ECOSTRESS-Daten...');
      
      const partialDebug: Partial<DebugInfo> = {
        proxyUrl: proxyUrl.substring(0, 80) + '...',
        proxyStatus: null,
        deckCanvasExists: false,
        rasterBounds: null,
        rawBounds: null,
        crs: null,
        minPixel: null,
        maxPixel: null,
        validPixels: 0,
        noDataPixels: 0,
        imageWidth: 0,
        imageHeight: 0,
      };

      try {
        const result = await fetchAndRenderCOG(cogUrl);
        
        if (cancelled) return;

        const dataUrl = imageDataToDataUrl(result.imageData);
        setImageUrl(dataUrl);
        setBounds(result.bounds);
        
        // Update debug info
        const fullDebug: DebugInfo = {
          proxyUrl: proxyUrl.substring(0, 80) + '...',
          proxyStatus: 200,
          deckCanvasExists: true,
          rasterBounds: result.bounds,
          rawBounds: result.rawBounds,
          crs: result.crs,
          minPixel: result.stats.min,
          maxPixel: result.stats.max,
          validPixels: result.stats.validPixels,
          noDataPixels: result.stats.noDataPixels,
          imageWidth: result.imageData.width,
          imageHeight: result.imageData.height,
        };
        setDebugInfo(fullDebug);
        onDebugInfo?.(fullDebug);
        
        setRenderState({ 
          status: 'rendered', 
          message: `${result.stats.validPixels.toLocaleString()} Pixel gerendert`,
          stats: result.stats,
        });
        onRenderStatus?.('rendered', `Rendered ${result.stats.validPixels} pixels`);
        
      } catch (err) {
        if (cancelled) return;
        
        console.error('[EcostressOverlay] Failed to render COG:', err);
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        setRenderState({ status: 'error', message });
        onRenderStatus?.('error', message);
        
        setDebugInfo({
          ...partialDebug as DebugInfo,
          proxyStatus: 500,
        });
      }
    }

    loadCOG();

    return () => {
      cancelled = true;
    };
  }, [cogUrl, visible, onRenderStatus, onDebugInfo]);

  // Manage deck.gl overlay with proper z-index handling
  useEffect(() => {
    if (!map) return;

    // Remove existing overlay
    if (overlayRef.current) {
      try {
        map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
      } catch {
        // Ignore if already removed
      }
      overlayRef.current = null;
    }

    // Don't add overlay if not visible or no image
    if (!visible || !imageUrl || !bounds) {
      return;
    }

    console.log('[EcostressOverlay] Adding BitmapLayer with WGS84 bounds:', bounds);

    try {
      const overlay = new MapboxOverlay({
        interleaved: false, // Render on top of all map layers
        layers: [
          new BitmapLayer({
            id: 'ecostress-heat-layer',
            bounds: bounds,
            image: imageUrl,
            opacity,
            pickable: false,
            // Debug: Use visible pixel borders
            parameters: {
              depthTest: false, // Ensure it renders on top
            },
          }),
        ],
      });

      map.addControl(overlay as unknown as maplibregl.IControl);
      overlayRef.current = overlay;
      
      // Verify deck canvas exists and is visible
      setTimeout(() => {
        const deckCanvas = document.querySelector('canvas.deck-canvas') as HTMLCanvasElement;
        if (deckCanvas) {
          console.log('[EcostressOverlay] Deck canvas found:', {
            width: deckCanvas.width,
            height: deckCanvas.height,
            visible: deckCanvas.style.display !== 'none',
            opacity: deckCanvas.style.opacity,
          });
          
          // Ensure proper z-index and visibility
          deckCanvas.style.pointerEvents = 'none';
        } else {
          console.warn('[EcostressOverlay] No deck canvas found in DOM!');
        }
      }, 100);
      
    } catch (err) {
      console.error('[EcostressOverlay] Failed to add overlay:', err);
      setRenderState({ 
        status: 'error', 
        message: err instanceof Error ? err.message : 'Failed to add overlay',
      });
    }

    return () => {
      if (overlayRef.current && map) {
        try {
          map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
        } catch {
          // Ignore cleanup errors
        }
        overlayRef.current = null;
      }
    };
  }, [map, visible, imageUrl, bounds, opacity]);

  // Update opacity without re-creating overlay
  useEffect(() => {
    if (!overlayRef.current || !imageUrl || !bounds) return;
    
    overlayRef.current.setProps({
      layers: [
        new BitmapLayer({
          id: 'ecostress-heat-layer',
          bounds: bounds,
          image: imageUrl,
          opacity,
          pickable: false,
          parameters: {
            depthTest: false,
          },
        }),
      ],
    });
  }, [opacity, imageUrl, bounds]);

  // Render status indicator
  if (!visible) return null;

  if (renderState.status === 'loading') {
    return (
      <div className="absolute top-16 right-4 bg-background/90 backdrop-blur px-3 py-2 rounded-lg text-sm z-10 flex items-center gap-2">
        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        {renderState.message}
      </div>
    );
  }

  if (renderState.status === 'error') {
    return (
      <div className="absolute top-16 right-4 bg-destructive/10 text-destructive px-3 py-2 rounded-lg text-sm max-w-xs z-10">
        <strong>Heat layer error:</strong> {renderState.message}
      </div>
    );
  }

  if (renderState.status === 'rendered' && renderState.stats) {
    const minC = (renderState.stats.min - 273.15).toFixed(1);
    const maxC = (renderState.stats.max - 273.15).toFixed(1);
    return (
      <div className="absolute top-16 right-4 bg-background/90 backdrop-blur px-3 py-2 rounded-lg text-xs z-10">
        <div className="font-medium text-sm mb-1">ECOSTRESS LST</div>
        <div className="text-muted-foreground">
          Datenwerte: {minC}°C – {maxC}°C
        </div>
        <div className="mt-2 h-2 w-32 rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 via-green-500 via-yellow-400 via-orange-500 to-red-500" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>-13°C</span>
          <span>47°C</span>
        </div>
        {renderState.stats.validPixels > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1">
            {renderState.stats.validPixels.toLocaleString()} Pixel
          </div>
        )}
      </div>
    );
  }

  return null;
}

export default EcostressOverlay;
