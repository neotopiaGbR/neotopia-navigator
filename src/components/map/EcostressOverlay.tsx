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

interface GranuleData {
  cog_url: string;
  cloud_mask_url?: string;
  datetime: string;
  granule_id: string;
  granule_bounds: [number, number, number, number];
}

interface EcostressOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  cogUrl?: string | null; // Legacy single URL
  allGranules?: GranuleData[]; // New: array of all granules for composite
  regionBbox?: [number, number, number, number];
  onRenderStatus?: (status: 'loading' | 'rendered' | 'error' | 'no_intersection', message?: string) => void;
  onDebugInfo?: (info: DebugInfo) => void;
}

export interface DebugInfo {
  proxyUrl: string;
  proxyStatus: number | null;
  deckCanvasExists: boolean;
  rasterBounds: [number, number, number, number] | null;
  dataExtent: [number, number, number, number] | null;
  rawBounds: number[] | null;
  crs: string | null;
  minPixel: number | null;
  maxPixel: number | null;
  validPixels: number;
  noDataPixels: number;
  imageWidth: number;
  imageHeight: number;
  intersectsRegion: boolean;
}

interface RenderResult {
  imageData: ImageData;
  bounds: [number, number, number, number]; // [west, south, east, north] in WGS84
  dataExtent: [number, number, number, number] | null; // Actual extent of valid pixels
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
 * Based on Karney's formulas - accurate for visualization
 */
function utmToWgs84(easting: number, northing: number, zone: number, isNorthernHemisphere: boolean): [number, number] {
  // WGS84 parameters
  const a = 6378137.0; // semi-major axis
  const f = 1 / 298.257223563; // flattening
  const k0 = 0.9996; // scale factor
  const e2 = 2 * f - f * f; // eccentricity squared
  const e = Math.sqrt(e2);
  const ep2 = e2 / (1 - e2); // second eccentricity squared
  
  // Remove false easting and false northing
  const x = easting - 500000;
  const y = isNorthernHemisphere ? northing : northing - 10000000;
  
  // Central meridian
  const lon0 = (zone - 1) * 6 - 180 + 3; // in degrees
  const lon0Rad = lon0 * Math.PI / 180;
  
  // Footpoint latitude
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
  
  // Latitude
  const lat = phi1 - (N1 * tanPhi1 / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D * D * D * D * D * D / 720
  );
  
  // Longitude
  const lon = lon0Rad + (
    D
    - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D / 120
  ) / cosPhi1;
  
  const latDeg = lat * 180 / Math.PI;
  const lonDeg = lon * 180 / Math.PI;
  
  return [lonDeg, isNorthernHemisphere ? latDeg : -latDeg];
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
  
  // First pass: find actual data range AND compute valid pixel extent
  let min = Infinity;
  let max = -Infinity;
  let validPixels = 0;
  let noDataPixels = 0;
  
  // Track min/max pixel coordinates for valid data extent
  let minPixelX = Infinity, maxPixelX = -Infinity;
  let minPixelY = Infinity, maxPixelY = -Infinity;
  
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
      
      // Track pixel extent
      const pixelX = i % targetWidth;
      const pixelY = Math.floor(i / targetWidth);
      if (pixelX < minPixelX) minPixelX = pixelX;
      if (pixelX > maxPixelX) maxPixelX = pixelX;
      if (pixelY < minPixelY) minPixelY = pixelY;
      if (pixelY > maxPixelY) maxPixelY = pixelY;
    }
  }
  
  // Compute actual data extent in WGS84 coordinates
  let dataExtent: [number, number, number, number] | null = null;
  if (validPixels > 0) {
    const [boundsWest, boundsSouth, boundsEast, boundsNorth] = wgs84Bounds;
    const boundsWidth = boundsEast - boundsWest;
    const boundsHeight = boundsNorth - boundsSouth;
    
    // Convert pixel extent to geographic extent
    // Note: Y is inverted (pixel 0 = north)
    const dataWest = boundsWest + (minPixelX / targetWidth) * boundsWidth;
    const dataEast = boundsWest + ((maxPixelX + 1) / targetWidth) * boundsWidth;
    const dataNorth = boundsNorth - (minPixelY / targetHeight) * boundsHeight;
    const dataSouth = boundsNorth - ((maxPixelY + 1) / targetHeight) * boundsHeight;
    
    dataExtent = [dataWest, dataSouth, dataEast, dataNorth];
  }
  
  console.log('[EcostressOverlay] Data range analysis:', {
    dimensions: `${targetWidth}x${targetHeight}`,
    validPixels,
    noDataPixels,
    minK: min.toFixed(2),
    maxK: max.toFixed(2),
    minC: (min - 273.15).toFixed(1),
    maxC: (max - 273.15).toFixed(1),
    pixelExtent: validPixels > 0 ? { minX: minPixelX, maxX: maxPixelX, minY: minPixelY, maxY: maxPixelY } : null,
    dataExtent,
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
    dataExtent,
  });
  
  return {
    imageData,
    bounds: wgs84Bounds,
    dataExtent,
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

interface RenderedLayer {
  imageUrl: string;
  bounds: [number, number, number, number];
  granuleId: string;
  datetime: string;
  stats: RenderResult['stats'];
}

export function EcostressOverlay({ 
  map, 
  visible, 
  opacity = 0.7, 
  cogUrl,
  allGranules,
  regionBbox,
  onRenderStatus,
  onDebugInfo,
}: EcostressOverlayProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [renderState, setRenderState] = useState<{
    status: 'idle' | 'loading' | 'rendered' | 'error' | 'no_intersection';
    message?: string;
    stats?: RenderResult['stats'];
    layerCount?: number;
  }>({ status: 'idle' });
  const [renderedLayers, setRenderedLayers] = useState<RenderedLayer[]>([]);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Helper: check if two bboxes intersect
  const bboxIntersects = (
    bbox1: [number, number, number, number],
    bbox2: [number, number, number, number]
  ): boolean => {
    return !(
      bbox1[2] < bbox2[0] || // bbox1 right < bbox2 left
      bbox1[0] > bbox2[2] || // bbox1 left > bbox2 right
      bbox1[3] < bbox2[1] || // bbox1 top < bbox2 bottom
      bbox1[1] > bbox2[3]    // bbox1 bottom > bbox2 top
    );
  };

  // Fetch and render all COGs when granules change
  useEffect(() => {
    // Build list of COG URLs to fetch
    const cogUrls: { url: string; granuleId: string; datetime: string }[] = [];
    
    if (allGranules && allGranules.length > 0) {
      allGranules.forEach(g => {
        if (g.cog_url) {
          cogUrls.push({ url: g.cog_url, granuleId: g.granule_id, datetime: g.datetime });
        }
      });
    } else if (cogUrl) {
      // Fallback to single URL for backwards compatibility
      cogUrls.push({ url: cogUrl, granuleId: 'single', datetime: '' });
    }
    
    if (!visible || cogUrls.length === 0) {
      setRenderState({ status: 'idle' });
      setRenderedLayers([]);
      setDebugInfo(null);
      return;
    }

    let cancelled = false;

    async function loadAllCOGs() {
      setRenderState({ status: 'loading', message: `Lade ${cogUrls.length} ECOSTRESS-Aufnahmen...` });
      onRenderStatus?.('loading', `Loading ${cogUrls.length} granules...`);
      
      const layers: RenderedLayer[] = [];
      let totalValidPixels = 0;
      let minTemp = Infinity;
      let maxTemp = -Infinity;
      let errorCount = 0;
      
      // Process all COGs (oldest first so newest renders on top)
      const sortedUrls = [...cogUrls].reverse();
      
      for (const { url, granuleId, datetime } of sortedUrls) {
        if (cancelled) return;
        
        try {
          console.log(`[EcostressOverlay] Loading granule ${granuleId}...`);
          const result = await fetchAndRenderCOG(url);
          
          // Check intersection with region
          let intersectsRegion = true;
          if (regionBbox && result.dataExtent) {
            intersectsRegion = bboxIntersects(result.dataExtent, regionBbox);
          }
          
          if (intersectsRegion && result.stats.validPixels > 0) {
            const dataUrl = imageDataToDataUrl(result.imageData);
            layers.push({
              imageUrl: dataUrl,
              bounds: result.bounds,
              granuleId,
              datetime,
              stats: result.stats,
            });
            
            totalValidPixels += result.stats.validPixels;
            if (result.stats.min < minTemp) minTemp = result.stats.min;
            if (result.stats.max > maxTemp) maxTemp = result.stats.max;
          }
        } catch (err) {
          console.warn(`[EcostressOverlay] Failed to load granule ${granuleId}:`, err);
          errorCount++;
        }
      }
      
      if (cancelled) return;
      
      if (layers.length === 0) {
        setRenderState({ 
          status: 'no_intersection', 
          message: errorCount > 0 
            ? `Alle ${cogUrls.length} Aufnahmen konnten nicht geladen werden`
            : 'Keine Daten schneiden die ausgewählte Region',
        });
        onRenderStatus?.('no_intersection', 'No valid layers');
        return;
      }
      
      setRenderedLayers(layers);
      setRenderState({ 
        status: 'rendered', 
        message: `${layers.length} Aufnahmen, ${totalValidPixels.toLocaleString()} Pixel`,
        stats: { min: minTemp, max: maxTemp, validPixels: totalValidPixels, noDataPixels: 0 },
        layerCount: layers.length,
      });
      onRenderStatus?.('rendered', `Rendered ${layers.length} layers with ${totalValidPixels} pixels`);
      
      // Update debug info for first layer
      if (layers.length > 0) {
        setDebugInfo({
          proxyUrl: `${cogUrls.length} COGs`,
          proxyStatus: 200,
          deckCanvasExists: true,
          rasterBounds: layers[0].bounds,
          dataExtent: null,
          rawBounds: null,
          crs: null,
          minPixel: minTemp,
          maxPixel: maxTemp,
          validPixels: totalValidPixels,
          noDataPixels: 0,
          imageWidth: 0,
          imageHeight: 0,
          intersectsRegion: true,
        });
      }
    }

    loadAllCOGs();

    return () => {
      cancelled = true;
    };
  }, [cogUrl, allGranules, visible, regionBbox, onRenderStatus, onDebugInfo]);

  // Manage deck.gl overlay with proper z-index handling
  useEffect(() => {
    if (!map) {
      console.log('[EcostressOverlay] No map instance yet');
      return;
    }

    // Remove existing overlay
    if (overlayRef.current) {
      try {
        map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
      } catch {
        // Ignore if already removed
      }
      overlayRef.current = null;
    }

    // Don't add overlay if not visible or no layers
    if (!visible || renderedLayers.length === 0) {
      console.log('[EcostressOverlay] Not adding overlay:', { visible, layerCount: renderedLayers.length });
      return;
    }

    // Ensure map style is loaded before adding control
    const addOverlay = () => {
      console.log('[EcostressOverlay] Adding', renderedLayers.length, 'BitmapLayers as composite');

      try {
        // Create stacked BitmapLayers - each layer renders on top of the previous
        const bitmapLayers = renderedLayers.map((layer, index) => 
          new BitmapLayer({
            id: `ecostress-heat-layer-${index}`,
            bounds: layer.bounds,
            image: layer.imageUrl,
            opacity,
            pickable: false,
            parameters: {
              depthTest: false,
            },
          })
        );

        const overlay = new MapboxOverlay({
          interleaved: false,
          layers: bitmapLayers,
        });

        map.addControl(overlay as unknown as maplibregl.IControl);
        overlayRef.current = overlay;
        
        console.log('[EcostressOverlay] ✅ Composite overlay added with', bitmapLayers.length, 'layers');
        
      } catch (err) {
        console.error('[EcostressOverlay] Failed to add overlay:', err);
        setRenderState({ 
          status: 'error', 
          message: err instanceof Error ? err.message : 'Failed to add overlay',
        });
      }
    };

    // Check if map style is loaded
    if (map.isStyleLoaded()) {
      addOverlay();
    } else {
      console.log('[EcostressOverlay] Waiting for map style to load...');
      map.once('style.load', addOverlay);
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
  }, [map, visible, renderedLayers, opacity]);

  // Update opacity without re-creating overlay
  useEffect(() => {
    if (!overlayRef.current || renderedLayers.length === 0) return;
    
    const bitmapLayers = renderedLayers.map((layer, index) => 
      new BitmapLayer({
        id: `ecostress-heat-layer-${index}`,
        bounds: layer.bounds,
        image: layer.imageUrl,
        opacity,
        pickable: false,
        parameters: {
          depthTest: false,
        },
      })
    );
    
    overlayRef.current.setProps({ layers: bitmapLayers });
  }, [opacity, renderedLayers]);

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
        <div className="font-medium text-sm mb-1">ECOSTRESS LST Komposit</div>
        <div className="text-muted-foreground">
          Datenwerte: {minC}°C – {maxC}°C
        </div>
        <div className="mt-2 h-2 w-32 rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 via-green-500 via-yellow-400 via-orange-500 to-red-500" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>-13°C</span>
          <span>47°C</span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          {renderState.layerCount || 1} Aufnahme{(renderState.layerCount || 1) > 1 ? 'n' : ''} • {renderState.stats.validPixels.toLocaleString()} Pixel
        </div>
      </div>
    );
  }

  return null;
}

export default EcostressOverlay;
