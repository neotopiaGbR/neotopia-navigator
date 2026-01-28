/**
 * Air Temperature Overlay (2m) - Germany Summer Composite
 * 
 * Renders ERA5-Land 2m air temperature data as a CONTINUOUS heatmap layer
 * using deck.gl HeatmapLayer for smooth bilinear interpolation.
 * 
 * This layer provides regional thermal context (~9 km resolution) and sits
 * BELOW the high-resolution ECOSTRESS LST hotspot layer.
 * 
 * Data source: Copernicus ERA5-Land via Open-Meteo Archive API
 * License: CC BY 4.0 (Copernicus Climate Change Service)
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { AirTemperatureData } from './MapLayersContext';

interface AirTemperatureOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  data: AirTemperatureData | null;
}

// Color ramp for air temperature (soft blue-green-yellow-orange)
// Deliberately distinct from ECOSTRESS LST ramp
const AIR_TEMP_COLOR_RANGE: [number, number, number, number][] = [
  [70, 130, 180, 255],   // Steel blue (coolest)
  [100, 180, 160, 255],  // Teal
  [140, 200, 120, 255],  // Light green
  [200, 210, 100, 255],  // Yellow-green
  [220, 200, 80, 255],   // Yellow-gold
  [230, 150, 60, 255],   // Orange
  [200, 80, 60, 255],    // Soft red (warmest)
];

export function AirTemperatureOverlay({
  map,
  visible,
  opacity = 0.6,
  data,
}: AirTemperatureOverlayProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const isAttachedRef = useRef(false);

  // Create/update the deck.gl overlay
  const updateOverlay = useCallback(() => {
    if (!map || !visible || !data) {
      // Remove overlay when not visible
      if (overlayRef.current && isAttachedRef.current) {
        try {
          map?.removeControl(overlayRef.current as unknown as maplibregl.IControl);
          isAttachedRef.current = false;
        } catch (e) {
          // Ignore
        }
      }
      return;
    }

    const { grid, normalization } = data;
    const { p5, p95 } = normalization;

    // Transform grid points into weighted data for HeatmapLayer
    // Weight is based on temperature (higher temp = higher weight for heat visualization)
    const heatmapData = grid.map(point => {
      // Normalize to 0-1 range using P5-P95
      const range = p95 - p5;
      const normalized = range > 0 
        ? Math.max(0, Math.min(1, (point.value - p5) / range))
        : 0.5;
      
      return {
        position: [point.lon, point.lat] as [number, number],
        weight: normalized,
        value: point.value,
      };
    });

    // Create HeatmapLayer with smooth interpolation
    const heatmapLayer = new HeatmapLayer({
      id: 'era5-air-temperature-heatmap',
      data: heatmapData,
      getPosition: (d: { position: [number, number] }) => d.position,
      getWeight: (d: { weight: number }) => d.weight,
      // Radius in pixels - large for smooth interpolation
      radiusPixels: 60,
      // Intensity scaling
      intensity: 1,
      // Threshold to start showing color
      threshold: 0.03,
      // Color range
      colorRange: AIR_TEMP_COLOR_RANGE,
      // Aggregation settings for smooth rendering
      aggregation: 'SUM',
      // Opacity
      opacity: opacity,
      // Visible
      visible: true,
      // Ensure proper bounds
      pickable: false,
    });

    // Create or update overlay
    if (!overlayRef.current) {
      overlayRef.current = new MapboxOverlay({
        interleaved: false,
        layers: [heatmapLayer],
      });
    } else {
      overlayRef.current.setProps({ layers: [heatmapLayer] });
    }

    // Attach to map if not already attached
    if (!isAttachedRef.current) {
      try {
        map.addControl(overlayRef.current as unknown as maplibregl.IControl);
        isAttachedRef.current = true;
        console.log('[AirTemperatureOverlay] HeatmapLayer attached with', grid.length, 'points');
      } catch (e) {
        console.error('[AirTemperatureOverlay] Failed to attach overlay:', e);
      }
    }
  }, [map, visible, data, opacity]);

  // Initialize and update overlay
  useEffect(() => {
    if (!map) return;

    const handleStyleLoad = () => {
      updateOverlay();
    };

    if (map.isStyleLoaded()) {
      updateOverlay();
    } else {
      map.once('style.load', handleStyleLoad);
    }

    return () => {
      if (overlayRef.current && isAttachedRef.current && map) {
        try {
          map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
          isAttachedRef.current = false;
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [map, updateOverlay]);

  // Update when visibility, opacity, or data changes
  useEffect(() => {
    updateOverlay();
  }, [updateOverlay]);

  return null;
}

export default AirTemperatureOverlay;
