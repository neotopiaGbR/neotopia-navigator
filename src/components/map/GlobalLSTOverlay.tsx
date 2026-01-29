/**
 * Global Land Surface Temperature Overlay (TIER 1)
 * 
 * Uses NASA GIBS MODIS LST tiles for guaranteed full coverage.
 * This is the base layer that ALWAYS renders when heat hotspots are enabled.
 */

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

interface GlobalLSTOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
}

// NASA GIBS MODIS Land Surface Temperature layers
// Using Terra MODIS LST Day (8-day rolling average for better coverage)
const MODIS_LST_TILES = {
  day: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_Land_Surface_Temp_8Day_Day/default/2024-01-01/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png',
  night: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_Land_Surface_Temp_8Day_Night/default/2024-01-01/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png',
};

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

export default function GlobalLSTOverlay({ map, visible, opacity = 0.6 }: GlobalLSTOverlayProps) {
  const isAddedRef = useRef(false);

  useEffect(() => {
    if (!map) return;

    const addLayer = () => {
      if (isAddedRef.current) return;
      if (map.getSource(SOURCE_ID)) return;

      try {
        const tileUrl = buildGIBSTileUrl('day');
        
        map.addSource(SOURCE_ID, {
          type: 'raster',
          tiles: [tileUrl],
          tileSize: 256,
          attribution: 'NASA GIBS / MODIS Terra LST',
          maxzoom: 7, // GIBS Level 7 max
        });

        // Add below regions layer if it exists
        const beforeLayer = map.getLayer('regions-fill') ? 'regions-fill' : undefined;
        
        map.addLayer({
          id: LAYER_ID,
          type: 'raster',
          source: SOURCE_ID,
          paint: {
            'raster-opacity': visible ? opacity : 0,
          },
        }, beforeLayer);

        isAddedRef.current = true;
        console.log('[GlobalLSTOverlay] MODIS LST base layer added');
      } catch (err) {
        console.error('[GlobalLSTOverlay] Failed to add layer:', err);
      }
    };

    if (map.isStyleLoaded()) {
      addLayer();
    } else {
      map.once('style.load', addLayer);
    }

    return () => {
      if (map && isAddedRef.current) {
        try {
          if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
          if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
          isAddedRef.current = false;
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    };
  }, [map]);

  // Update visibility/opacity
  useEffect(() => {
    if (!map || !isAddedRef.current) return;
    
    try {
      if (map.getLayer(LAYER_ID)) {
        map.setPaintProperty(LAYER_ID, 'raster-opacity', visible ? opacity : 0);
      }
    } catch (err) {
      console.error('[GlobalLSTOverlay] Failed to update opacity:', err);
    }
  }, [map, visible, opacity]);

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
