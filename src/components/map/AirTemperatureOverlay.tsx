/**
 * Air Temperature Overlay (2m) - Germany Summer Composite
 * 
 * Renders DWD HYRAS-DE 1km air temperature as GRID CELL POLYGONS
 * using native MapLibre GeoJSON source/layer for reliable rendering.
 *
 * Implementation notes:
 * - Each data point becomes a visible ~3km polygon cell (when sampled)
 * - Cells without data are left transparent (no interpolation)
 * - Uses perceptual blue→yellow→red color scale (15°C–32°C)
 * - Germany-wide normalization (P5–P95) from backend
 * 
 * Data source: Deutscher Wetterdienst (DWD), HYRAS-DE
 * License: CC BY 4.0
 */

import { useEffect, useRef, useMemo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { AirTemperatureData } from './MapLayersContext';
import { gridToGeoJson, buildTemperatureColorExpression } from './airTemperature/gridToGeoJson';

interface AirTemperatureOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  data: AirTemperatureData | null;
}

const SOURCE_ID = 'dwd-air-temperature-source';
const FILL_LAYER_ID = 'dwd-air-temperature-fill';
const OUTLINE_LAYER_ID = 'dwd-air-temperature-outline';

export function AirTemperatureOverlay({
  map,
  visible,
  opacity = 0.6,
  data,
}: AirTemperatureOverlayProps) {
  const isAddedRef = useRef(false);

  // Convert grid data to GeoJSON with cell polygons
  const geoJsonData = useMemo(() => {
    if (!data || !data.grid || data.grid.length === 0) {
      return null;
    }
    
    const geojson = gridToGeoJson(data.grid, data.normalization);
    console.log('[AirTemperatureOverlay] GeoJSON created:', {
      features: geojson.features.length,
      sampleFeature: geojson.features[0]?.properties,
    });
    return geojson;
  }, [data]);

  // Use shared color expression from gridToGeoJson
  const colorExpression = buildTemperatureColorExpression();

  // Add/update the layer
  useEffect(() => {
    if (!map) return;

    const addLayer = () => {
      // Remove existing if present
      try {
        if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID);
        if (map.getLayer(OUTLINE_LAYER_ID)) map.removeLayer(OUTLINE_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        isAddedRef.current = false;
      } catch (e) {
        // ignore
      }

      if (!visible || !geoJsonData || geoJsonData.features.length === 0) {
        return;
      }

      try {
        // Add GeoJSON source
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: geoJsonData,
        });

        // Add fill layer - insert below regions layer
        const beforeLayer = map.getLayer('regions-fill') ? 'regions-fill' : undefined;
        
        map.addLayer({
          id: FILL_LAYER_ID,
          type: 'fill',
          source: SOURCE_ID,
          paint: {
            'fill-color': colorExpression,
            'fill-opacity': opacity,
          },
        }, beforeLayer);

        // Add subtle outline for cells
        map.addLayer({
          id: OUTLINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': 'rgba(80, 80, 80, 0.3)',
            'line-width': 0.5,
          },
        }, beforeLayer);

        isAddedRef.current = true;
        console.log('[AirTemperatureOverlay] Native MapLibre layers added:', {
          cells: geoJsonData.features.length,
          opacity,
        });
      } catch (err) {
        console.error('[AirTemperatureOverlay] Failed to add layers:', err);
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
          if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID);
          if (map.getLayer(OUTLINE_LAYER_ID)) map.removeLayer(OUTLINE_LAYER_ID);
          if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
          isAddedRef.current = false;
        } catch (e) {
          // ignore
        }
      }
    };
  }, [map, visible, geoJsonData, opacity]);

  // Update opacity when it changes
  useEffect(() => {
    if (!map || !isAddedRef.current) return;

    try {
      if (map.getLayer(FILL_LAYER_ID)) {
        map.setPaintProperty(FILL_LAYER_ID, 'fill-opacity', visible ? opacity : 0);
      }
    } catch (err) {
      console.error('[AirTemperatureOverlay] Failed to update opacity:', err);
    }
  }, [map, visible, opacity]);

  return null;
}

export default AirTemperatureOverlay;
