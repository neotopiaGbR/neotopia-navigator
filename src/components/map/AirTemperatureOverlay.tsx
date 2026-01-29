import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { buildTemperatureColorExpression } from './basemapStyles';
import { gridToGeoJson, type GridPoint } from './airTemperature/gridToGeoJson';

interface AirTemperatureOverlayProps {
  data: GridPoint[] | null;
  visible: boolean;
  opacity?: number;
  normalization?: { min: number; max: number };
}

export function AirTemperatureOverlay({ 
  data, 
  visible, 
  opacity = 0.8,
  normalization = { min: -10, max: 40 }
}: AirTemperatureOverlayProps) {
  
  // 1. Convert Grid to GeoJSON (memoized for performance)
  const geoJsonData = useMemo<FeatureCollection | null>(() => {
    if (!data || data.length === 0) return null;
    return gridToGeoJson(data);
  }, [data]);

  // 2. Build Style Expressions
  const layerStyle = useMemo(() => {
    return {
      id: 'air-temp-circles',
      type: 'circle' as const,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          5, 2,   // Klein bei Zoom out
          10, 5,  // Mittel
          15, 10  // Groß bei Zoom in
        ],
        'circle-color': buildTemperatureColorExpression(normalization.min, normalization.max),
        'circle-opacity': opacity,
        'circle-stroke-width': 0,
      }
    };
  }, [normalization.min, normalization.max, opacity]);

  if (!visible || !geoJsonData) return null;

  return (
    <Source id="air-temp-source" type="geojson" data={geoJsonData}>
      <Layer {...layerStyle} />
    </Source>
  );
}

export default AirTemperatureOverlay;
