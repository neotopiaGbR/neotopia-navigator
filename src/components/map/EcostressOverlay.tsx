/**
 * ECOSTRESS Heat Overlay using deck.gl + geotiff.js
 * 
 * Renders NASA ECOSTRESS Land Surface Temperature COGs client-side.
 * Uses ecostress-proxy Edge Function for authenticated Range-request access.
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
}

interface RenderResult {
  imageData: ImageData;
  bounds: [number, number, number, number]; // [west, south, east, north]
  stats: { min: number; max: number; validPixels: number; noDataPixels: number };
}

// LST temperature range (Kelvin) for colorization
const LST_MIN = 273; // 0°C
const LST_MAX = 323; // 50°C

/**
 * Heat colormap: blue → cyan → green → yellow → red
 */
function kelvinToRGBA(kelvin: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (kelvin - LST_MIN) / (LST_MAX - LST_MIN)));
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
  
  return [r, g, b, 200]; // Semi-transparent
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
  const bbox = image.getBoundingBox(); // [west, south, east, north]
  
  console.log('[EcostressOverlay] COG metadata:', { width, height, bbox });
  
  // Read raster data - use overview for performance if available
  const overviews = image.fileDirectory.Overviews || [];
  const targetWidth = Math.min(width, 512); // Limit resolution for performance
  const targetHeight = Math.round((targetWidth / width) * height);
  
  const rasters = await image.readRasters({
    width: targetWidth,
    height: targetHeight,
    interleave: false,
  });
  
  const lstData = rasters[0] as Float32Array | Float64Array | Uint16Array;
  
  // Create ImageData with colorized pixels
  const imageData = new ImageData(targetWidth, targetHeight);
  const data = imageData.data;
  
  let min = Infinity;
  let max = -Infinity;
  let validPixels = 0;
  let noDataPixels = 0;
  
  for (let i = 0; i < lstData.length; i++) {
    const value = lstData[i];
    const pixelOffset = i * 4;
    
    // Check for nodata (typically 0, negative, or very low values for LST)
    if (value <= 0 || value < 200 || isNaN(value)) {
      noDataPixels++;
      // Transparent pixel
      data[pixelOffset] = 0;
      data[pixelOffset + 1] = 0;
      data[pixelOffset + 2] = 0;
      data[pixelOffset + 3] = 0;
    } else {
      validPixels++;
      if (value < min) min = value;
      if (value > max) max = value;
      
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
    tempRange: validPixels > 0 ? `${(min - 273.15).toFixed(1)}°C to ${(max - 273.15).toFixed(1)}°C` : 'N/A',
  });
  
  if (validPixels === 0) {
    throw new Error('COG contains no valid LST data');
  }
  
  return {
    imageData,
    bounds: bbox as [number, number, number, number],
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
}: EcostressOverlayProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [renderState, setRenderState] = useState<{
    status: 'idle' | 'loading' | 'rendered' | 'error';
    message?: string;
    stats?: RenderResult['stats'];
  }>({ status: 'idle' });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);

  // Fetch and render COG when cogUrl changes
  useEffect(() => {
    if (!visible || !cogUrl) {
      setRenderState({ status: 'idle' });
      setImageUrl(null);
      setBounds(null);
      return;
    }

    let cancelled = false;

    async function loadCOG() {
      setRenderState({ status: 'loading', message: 'Lade ECOSTRESS-Daten...' });
      onRenderStatus?.('loading', 'Lade ECOSTRESS-Daten...');

      try {
        const result = await fetchAndRenderCOG(cogUrl);
        
        if (cancelled) return;

        const dataUrl = imageDataToDataUrl(result.imageData);
        setImageUrl(dataUrl);
        setBounds(result.bounds);
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
      }
    }

    loadCOG();

    return () => {
      cancelled = true;
    };
  }, [cogUrl, visible, onRenderStatus]);

  // Manage deck.gl overlay
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

    console.log('[EcostressOverlay] Adding BitmapLayer with bounds:', bounds);

    try {
      const overlay = new MapboxOverlay({
        layers: [
          new BitmapLayer({
            id: 'ecostress-heat-layer',
            bounds: bounds,
            image: imageUrl,
            opacity,
          }),
        ],
      });

      map.addControl(overlay as unknown as maplibregl.IControl);
      overlayRef.current = overlay;
      
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
      <div className="absolute top-16 right-4 bg-background/80 backdrop-blur px-3 py-2 rounded-lg text-xs z-10">
        <div className="font-medium text-sm mb-1">ECOSTRESS LST</div>
        <div className="text-muted-foreground">
          {minC}°C – {maxC}°C
        </div>
        <div className="mt-2 h-2 w-32 rounded-full bg-gradient-to-r from-blue-500 via-green-500 via-yellow-500 to-red-500" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>0°C</span>
          <span>50°C</span>
        </div>
      </div>
    );
  }

  return null;
}

export default EcostressOverlay;
