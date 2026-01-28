/**
 * Air Temperature Overlay (2m) - Germany Summer Composite
 * 
 * Renders ERA5-Land 2m air temperature data as a CONTINUOUS heatmap layer
 * using MapLibre's native heatmap layer type for smooth, GPU-accelerated rendering.
 * 
 * This layer provides regional thermal context (~9 km resolution) and sits
 * BELOW the high-resolution ECOSTRESS LST hotspot layer.
 * 
 * Data source: Copernicus ERA5-Land via Open-Meteo Archive API
 * License: CC BY 4.0 (Copernicus Climate Change Service)
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { AirTemperatureData } from './MapLayersContext';

interface AirTemperatureOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  data: AirTemperatureData | null;
}

const SOURCE_ID = 'air-temp-source';
const HEATMAP_LAYER_ID = 'air-temp-heatmap';

export function AirTemperatureOverlay({
  map,
  visible,
  opacity = 0.6,
  data,
}: AirTemperatureOverlayProps) {
  const isAddedRef = useRef(false);

  // Generate GeoJSON point features for heatmap
  const generateGeoJSON = useCallback((gridData: AirTemperatureData): GeoJSON.FeatureCollection => {
    const { grid, normalization } = gridData;
    const { p5, p95 } = normalization;
    const range = p95 - p5;

    const features: GeoJSON.Feature[] = grid.map(point => {
      // Normalize to 0-1 range using P5-P95
      const normalized = range > 0 
        ? Math.max(0, Math.min(1, (point.value - p5) / range))
        : 0.5;
      
      return {
        type: 'Feature',
        properties: {
          value: point.value,
          weight: normalized,
        },
        geometry: {
          type: 'Point',
          coordinates: [point.lon, point.lat],
        },
      };
    });

    return {
      type: 'FeatureCollection',
      features,
    };
  }, []);

  // Add/update heatmap layer
  useEffect(() => {
    if (!map) return;

    const addLayers = () => {
      if (!visible || !data) {
        // Remove layers when not visible
        if (isAddedRef.current) {
          try {
            if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
            if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
            isAddedRef.current = false;
          } catch (e) {
            // Ignore
          }
        }
        return;
      }

      try {
        // Remove existing layers first
        if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

        const geojson = generateGeoJSON(data);

        // Add source
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: geojson,
        });

        // Add heatmap layer using MapLibre's native heatmap type
        // This provides smooth, continuous rendering without tile seams
        map.addLayer({
          id: HEATMAP_LAYER_ID,
          type: 'heatmap',
          source: SOURCE_ID,
          paint: {
            // Weight based on normalized temperature value
            'heatmap-weight': ['get', 'weight'],
            
            // Intensity increases with zoom for better visibility
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              4, 0.8,
              6, 1.0,
              8, 1.2,
              10, 1.5,
            ],
            
            // Radius in pixels - large for smooth interpolation across ~9km grid
            'heatmap-radius': [
              'interpolate', ['linear'], ['zoom'],
              4, 30,  // At zoom 4, 30px radius
              6, 50,  // At zoom 6, 50px radius
              8, 80,  // At zoom 8, 80px radius
              10, 120, // At zoom 10, 120px radius
            ],
            
            // Color ramp: blue → teal → green → yellow → orange → soft red
            // Distinct from ECOSTRESS to differentiate air vs surface temp
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0.0, 'rgba(70, 130, 180, 0)',     // Transparent at 0
              0.1, 'rgba(70, 130, 180, 0.4)',   // Steel blue
              0.25, 'rgba(100, 180, 160, 0.5)', // Teal
              0.4, 'rgba(140, 200, 120, 0.6)',  // Light green
              0.55, 'rgba(200, 210, 100, 0.7)', // Yellow-green
              0.7, 'rgba(220, 200, 80, 0.8)',   // Yellow-gold
              0.85, 'rgba(230, 150, 60, 0.9)',  // Orange
              1.0, 'rgba(200, 80, 60, 1)',      // Soft red
            ],
            
            // Opacity
            'heatmap-opacity': opacity,
          },
        }, 'regions-fill'); // Insert BELOW regions layer

        isAddedRef.current = true;
        console.log('[AirTemperatureOverlay] Native heatmap layer added with', data.grid.length, 'points');

      } catch (err) {
        console.error('[AirTemperatureOverlay] Failed to add layer:', err);
      }
    };

    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      map.once('style.load', addLayers);
    }

    return () => {
      if (map && isAddedRef.current) {
        try {
          if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
          if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
          isAddedRef.current = false;
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [map, visible, data, generateGeoJSON, opacity]);

  // Update opacity
  useEffect(() => {
    if (!map || !isAddedRef.current) return;

    try {
      if (map.getLayer(HEATMAP_LAYER_ID)) {
        map.setPaintProperty(HEATMAP_LAYER_ID, 'heatmap-opacity', opacity);
      }
    } catch (e) {
      // Ignore
    }
  }, [map, opacity]);

  return null;
}

export default AirTemperatureOverlay;
