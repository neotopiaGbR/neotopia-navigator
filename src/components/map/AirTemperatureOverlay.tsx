import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { gridToGeoJson, type GridPoint } from './airTemperature/gridToGeoJson';

interface AirTemperatureOverlayProps {
  data: GridPoint[] | null | undefined;
  visible: boolean;
  opacity?: number;
  /** Cell size in meters for proper polygon sizing */
  cellSizeMeters?: number;
}

/**
 * Build MapLibre color expression for temperature fill.
 * Uses the DWD preferred color ramp:
 * - <18°C: blue
 * - 18-22°C: green
 * - 22-26°C: yellow
 * - 26-30°C: orange
 * - >30°C: red
 */
function buildTemperatureFillColor(): any {
  return [
    'interpolate',
    ['linear'],
    ['get', 'value'],
    14, '#2563eb',  // blue (cold)
    18, '#22c55e',  // green
    22, '#eab308',  // yellow
    26, '#f97316',  // orange
    30, '#dc2626',  // red (hot)
    35, '#7f1d1d',  // dark red (extreme)
  ];
}

export function AirTemperatureOverlay({ 
  data, 
  visible, 
  opacity = 0.75,
  cellSizeMeters = 3000,
}: AirTemperatureOverlayProps) {
  
  // Convert grid points to polygon GeoJSON with proper cell sizing
  const geoJsonData = useMemo<FeatureCollection | null>(() => {
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    try {
      return gridToGeoJson(data, cellSizeMeters);
    } catch (e) {
      console.warn('[AirTemperatureOverlay] Failed to convert grid:', e);
      return null;
    }
  }, [data, cellSizeMeters]);

  const fillStyle = useMemo<any>(() => {
    return {
      id: 'air-temp-fill',
      type: 'fill' as const,
      paint: {
        'fill-color': buildTemperatureFillColor(),
        'fill-opacity': opacity,
      }
    };
  }, [opacity]);

  const outlineStyle = useMemo<any>(() => {
    return {
      id: 'air-temp-outline',
      type: 'line' as const,
      paint: {
        'line-color': 'rgba(0, 0, 0, 0.1)',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          5, 0,
          10, 0.5,
          15, 1
        ],
      }
    };
  }, []);

  if (!visible || !geoJsonData) return null;

  return (
    <Source id="air-temp-source" type="geojson" data={geoJsonData}>
      <Layer {...fillStyle} />
      <Layer {...outlineStyle} />
    </Source>
  );
}

export default AirTemperatureOverlay;
