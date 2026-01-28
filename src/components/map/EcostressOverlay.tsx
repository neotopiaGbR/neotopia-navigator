/**
 * ECOSTRESS Heat Overlay using deck.gl
 * 
 * Renders NASA ECOSTRESS Land Surface Temperature COGs client-side.
 * Uses ecostress-proxy Edge Function for authenticated Range-request access.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer } from '@deck.gl/layers';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';

interface EcostressOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  cogUrl: string | null;
  bounds?: [number, number, number, number]; // [west, south, east, north]
}

// LST temperature range (Kelvin) for colorization
const LST_MIN = 273; // 0°C
const LST_MAX = 323; // 50°C

/**
 * Heat colormap: blue → cyan → green → yellow → red
 */
function heatToRGBA(kelvin: number): [number, number, number, number] {
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
  
  return [r, g, b, 220];
}

export function EcostressOverlay({ map, visible, opacity = 0.7, cogUrl, bounds }: EcostressOverlayProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    // Don't add if not visible or no COG URL
    if (!visible || !cogUrl) {
      return;
    }

    // Build proxied URL for authenticated COG access
    const proxyUrl = `${SUPABASE_URL}/functions/v1/ecostress-proxy?url=${encodeURIComponent(cogUrl)}`;

    console.log('[EcostressOverlay] Adding layer with proxy URL:', proxyUrl.substring(0, 100));

    try {
      // Use BitmapLayer with the proxied COG
      // For full COG support, we'd need geotiff.js client-side parsing
      // This is a simplified approach that works for overview images
      
      const layerBounds = bounds || [-180, -85, 180, 85];
      
      const overlay = new MapboxOverlay({
        layers: [
          new BitmapLayer({
            id: 'ecostress-heat-layer',
            bounds: layerBounds,
            image: proxyUrl,
            opacity,
            // Note: BitmapLayer expects a standard image format
            // For COG rendering, we need TileLayer with custom tile loading
            loadOptions: {
              fetch: {
                headers: {
                  'Accept': 'image/*,*/*',
                },
              },
            },
          }),
        ],
      });

      map.addControl(overlay as unknown as maplibregl.IControl);
      overlayRef.current = overlay;
      setError(null);
      
    } catch (err) {
      console.error('[EcostressOverlay] Failed to add overlay:', err);
      setError(err instanceof Error ? err.message : 'Failed to add heat layer');
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
  }, [map, visible, cogUrl, opacity, bounds]);

  // Show error if any
  if (error && visible) {
    return (
      <div className="absolute top-16 right-4 bg-destructive/10 text-destructive px-3 py-2 rounded-lg text-sm max-w-xs z-10">
        Heat layer error: {error}
      </div>
    );
  }

  return null;
}

export default EcostressOverlay;
