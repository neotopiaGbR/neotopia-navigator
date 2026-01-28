/**
 * Global Land Surface Temperature Overlay (TIER 1)
 * 
 * Uses NASA GIBS MODIS LST tiles for guaranteed full coverage.
 * This is the base layer that ALWAYS renders when heat hotspots are enabled.
 * 
 * ARCHITECTURE FIX (2026-01):
 * - Uses persistent style.load listener for basemap changes
 * - Properly cleans up and re-adds layer on style switches
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

interface GlobalLSTOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
}

// Get the latest available GIBS date (typically 1-3 days lag)
function getLatestGIBSDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 3); // GIBS has ~3 day latency
  return date.toISOString().split('T')[0];
}

// Build dynamic GIBS tile URL
function buildGIBSTileUrl(variant: 'day' | 'night' = 'day'): string {
  const date = getLatestGIBSDate();
  const layer = variant === 'day' 
    ? 'MODIS_Terra_L3_Land_Surface_Temp_8Day_Day'
    : 'MODIS_Terra_L3_Land_Surface_Temp_8Day_Night';
  
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;
}

const SOURCE_ID = 'global-lst-source';
const LAYER_ID = 'global-lst-layer';

export function GlobalLSTOverlay({ map, visible, opacity = 0.6 }: GlobalLSTOverlayProps) {
  const isAddedRef = useRef(false);
  const visibleRef = useRef(visible);
  const opacityRef = useRef(opacity);
  
  // Keep refs in sync
  visibleRef.current = visible;
  opacityRef.current = opacity;

  // Add layer to map
  const addLayer = useCallback(() => {
    if (!map) return;
    
    // Remove existing if present
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      isAddedRef.current = false;
    } catch {
      // Ignore cleanup errors
    }

    // Don't add if not visible
    if (!visibleRef.current) {
      console.log('[GlobalLSTOverlay] Layer not visible, skipping');
      return;
    }

    try {
      const tileUrl = buildGIBSTileUrl('day');
      console.log('[GlobalLSTOverlay] Adding MODIS LST layer');
      
      map.addSource(SOURCE_ID, {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution: 'NASA GIBS / MODIS Terra LST',
        maxzoom: 7,
      });

      // Add below regions layer if it exists
      const beforeLayer = map.getLayer('regions-fill') ? 'regions-fill' : undefined;
      
      map.addLayer({
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: {
          'raster-opacity': opacityRef.current,
        },
      }, beforeLayer);

      isAddedRef.current = true;
      console.log('[GlobalLSTOverlay] ✅ MODIS LST base layer added successfully');
    } catch (err) {
      console.error('[GlobalLSTOverlay] Failed to add layer:', err);
    }
  }, [map]);

  // Remove layer from map
  const removeLayer = useCallback(() => {
    if (!map) return;
    
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      isAddedRef.current = false;
      console.log('[GlobalLSTOverlay] Layer removed');
    } catch {
      // Ignore cleanup errors
    }
  }, [map]);

  // Main effect: handle map lifecycle and style changes
  useEffect(() => {
    if (!map) return;

    const handleStyleLoad = () => {
      // Re-add layer after style change (basemap switch)
      setTimeout(() => {
        if (visibleRef.current) {
          addLayer();
        }
      }, 100);
    };

    // Initial setup
    if (map.isStyleLoaded()) {
      if (visible) {
        addLayer();
      }
    } else {
      map.once('style.load', () => {
        if (visibleRef.current) {
          addLayer();
        }
      });
    }

    // Listen for style changes (basemap switches)
    map.on('style.load', handleStyleLoad);

    return () => {
      map.off('style.load', handleStyleLoad);
      removeLayer();
    };
  }, [map, addLayer, removeLayer]);

  // Handle visibility changes
  useEffect(() => {
    if (!map) return;
    
    if (visible) {
      // Add layer if not already added
      if (!isAddedRef.current && map.isStyleLoaded()) {
        addLayer();
      }
    } else {
      // Remove layer when hidden
      removeLayer();
    }
  }, [map, visible, addLayer, removeLayer]);

  // Update opacity dynamically without re-adding layer
  useEffect(() => {
    if (!map || !isAddedRef.current) return;
    
    try {
      if (map.getLayer(LAYER_ID)) {
        map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
      }
    } catch (err) {
      console.error('[GlobalLSTOverlay] Failed to update opacity:', err);
    }
  }, [map, opacity]);

  return null;
}

export const GLOBAL_LST_INFO = {
  source: 'MODIS Terra LST',
  provider: 'NASA GIBS',
  resolution: '1 km',
  temporalResolution: '8-day composite',
  coverage: '100% global',
  latency: '~3 days',
  attribution: 'NASA GIBS / MODIS Terra Land Surface Temperature',
  doi: 'https://doi.org/10.5067/MODIS/MOD11A2.061',
};
