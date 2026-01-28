/**
 * Air Temperature Overlay (2m) - Germany Summer Composite
 * 
 * Renders ERA5-Land 2m air temperature data as a smooth, low-frequency
 * background layer. Uses Germany-wide P5-P95 normalization for consistent
 * color scale across the entire country.
 * 
 * Data source: Copernicus ERA5-Land via Open-Meteo Archive API
 * License: CC BY 4.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { AirTemperatureData, AirTemperatureMetadata } from './MapLayersContext';

interface AirTemperatureOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  data: AirTemperatureData | null;
  onMetadata?: (metadata: AirTemperatureMetadata | null) => void;
}

// Soft, distinct color ramp for air temperature (blue-green-yellow-orange)
// Deliberately different from LST ramp to differentiate air vs surface temp
const AIR_TEMP_COLORS = [
  { value: 0.0, color: [70, 130, 180] },   // Steel blue (coolest)
  { value: 0.2, color: [100, 180, 160] },  // Teal
  { value: 0.4, color: [140, 200, 120] },  // Light green
  { value: 0.6, color: [220, 200, 80] },   // Yellow-gold
  { value: 0.8, color: [230, 150, 60] },   // Orange
  { value: 1.0, color: [200, 80, 60] },    // Soft red (warmest)
];

function interpolateColor(t: number): [number, number, number] {
  // Clamp to [0, 1]
  const clamped = Math.max(0, Math.min(1, t));
  
  // Find the two colors to interpolate between
  for (let i = 0; i < AIR_TEMP_COLORS.length - 1; i++) {
    const c1 = AIR_TEMP_COLORS[i];
    const c2 = AIR_TEMP_COLORS[i + 1];
    
    if (clamped >= c1.value && clamped <= c2.value) {
      const localT = (clamped - c1.value) / (c2.value - c1.value);
      return [
        Math.round(c1.color[0] + localT * (c2.color[0] - c1.color[0])),
        Math.round(c1.color[1] + localT * (c2.color[1] - c1.color[1])),
        Math.round(c1.color[2] + localT * (c2.color[2] - c1.color[2])),
      ];
    }
  }
  
  return AIR_TEMP_COLORS[AIR_TEMP_COLORS.length - 1].color as [number, number, number];
}

export function AirTemperatureOverlay({
  map,
  visible,
  opacity = 0.6,
  data,
  onMetadata,
}: AirTemperatureOverlayProps) {
  const sourceId = 'air-temp-source';
  const layerId = 'air-temp-layer';
  const [isAdded, setIsAdded] = useState(false);
  const onMetadataRef = useRef(onMetadata);
  onMetadataRef.current = onMetadata;

  // Generate GeoJSON heatmap from grid points
  const generateGeoJSON = useCallback((gridData: AirTemperatureData): GeoJSON.FeatureCollection => {
    const { grid, normalization } = gridData;
    const { p5, p95 } = normalization;
    const range = p95 - p5;
    
    const features: GeoJSON.Feature[] = grid.map(point => {
      // Normalize temperature to 0-1 using P5-P95
      const normalizedValue = range > 0 
        ? Math.max(0, Math.min(1, (point.value - p5) / range))
        : 0.5;
      
      const color = interpolateColor(normalizedValue);
      
      // Create a small square for each grid point (~9km cells)
      const halfSize = 0.05; // ~5km half-width
      
      return {
        type: 'Feature',
        properties: {
          value: point.value,
          normalizedValue,
          color: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [point.lon - halfSize, point.lat - halfSize],
            [point.lon + halfSize, point.lat - halfSize],
            [point.lon + halfSize, point.lat + halfSize],
            [point.lon - halfSize, point.lat + halfSize],
            [point.lon - halfSize, point.lat - halfSize],
          ]],
        },
      };
    });

    return {
      type: 'FeatureCollection',
      features,
    };
  }, []);

  // Add/update layer
  useEffect(() => {
    if (!map || !visible || !data) {
      // Remove layer if hidden or no data
      if (map && isAdded) {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(sourceId)) map.removeSource(sourceId);
          setIsAdded(false);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      onMetadataRef.current?.(null);
      return;
    }

    const addLayer = () => {
      try {
        // Remove existing if present
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        const geojson = generateGeoJSON(data);

        map.addSource(sourceId, {
          type: 'geojson',
          data: geojson,
        });

        // Add as fill layer (rendered below regions)
        map.addLayer({
          id: layerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': opacity,
            'fill-antialias': true,
          },
        }, 'regions-fill'); // Insert BELOW regions layer

        setIsAdded(true);

        // Report metadata
        onMetadataRef.current?.({
          year: data.year,
          aggregation: data.aggregation,
          period: data.period,
          resolution_km: data.resolution_km,
          normalization: data.normalization,
          pointCount: data.grid.length,
        });

        console.log('[AirTemperatureOverlay] Layer added with', data.grid.length, 'points');
      } catch (err) {
        console.error('[AirTemperatureOverlay] Failed to add layer:', err);
      }
    };

    if (map.isStyleLoaded()) {
      addLayer();
    } else {
      map.once('style.load', addLayer);
    }

    return () => {
      if (map) {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [map, visible, data, generateGeoJSON, isAdded]);

  // Update opacity
  useEffect(() => {
    if (!map || !isAdded) return;
    
    try {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'fill-opacity', opacity);
      }
    } catch (e) {
      // Ignore
    }
  }, [map, isAdded, opacity]);

  return null; // This component doesn't render DOM elements
}

export default AirTemperatureOverlay;
