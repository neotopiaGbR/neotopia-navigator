import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { buildTemperatureColorExpression } from './basemapStyles';
import { gridToGeoJson, type GridPoint } from './airTemperature/gridToGeoJson';

interface AirTemperatureOverlayProps {
  data: GridPoint[] | null | undefined;
  visible: boolean;
  opacity?: number;
}

export function AirTemperatureOverlay({ 
  data, 
  visible, 
  opacity = 0.8 
}: AirTemperatureOverlayProps) {
  
  // Robust GeoJSON conversion
  const geoJsonData = useMemo<FeatureCollection | null>(() => {
    // Safety check: is data an array?
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    try {
      return gridToGeoJson(data);
    } catch (e) {
      console.warn('[AirTemperatureOverlay] Failed to convert grid:', e);
      return null;
    }
  }, [data]);

  const layerStyle = useMemo(() => {
    return {
      id: 'air-temp-circles',
      type: 'circle' as const,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          5, 2,
          10, 5,
          15, 10
        ],
        'circle-color': buildTemperatureColorExpression(-10, 40),
        'circle-opacity': opacity,
        'circle-stroke-width': 0,
      }
    };
  }, [opacity]);

  if (!visible || !geoJsonData) return null;

  return (
    <Source id="air-temp-source" type="geojson" data={geoJsonData}>
      <Layer {...layerStyle} />
    </Source>
  );
}

export default AirTemperatureOverlay;
