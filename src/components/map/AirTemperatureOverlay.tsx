/**
 * Air Temperature Overlay (2m) - Germany Summer Composite
 * 
 * Renders ERA5-Land 2m air temperature as EXPLICIT 0.1° GRID CELL POLYGONS
 * using deck.gl GeoJsonLayer via MapboxOverlay.
 *
 * Implementation notes:
 * - Each data point becomes a visible 0.1° (~9km) polygon cell
 * - Cells without data are left transparent (no interpolation)
 * - Uses perceptual blue→yellow→red color scale
 * - Germany-wide normalization (P5–P95) from backend
 * 
 * Data source: Copernicus ERA5-Land via Open-Meteo Archive API
 * License: CC BY 4.0 (Copernicus Climate Change Service)
 */

import { useEffect, useMemo, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { GeoJsonLayer } from '@deck.gl/layers';
import { AirTemperatureData } from './MapLayersContext';
import { gridToGeoJson } from './airTemperature/gridToGeoJson';

interface AirTemperatureOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  data: AirTemperatureData | null;
}

export function AirTemperatureOverlay({
  map,
  visible,
  opacity = 0.6,
  data,
}: AirTemperatureOverlayProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);

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

  // Mount/unmount deck.gl GeoJsonLayer via MapboxOverlay
  useEffect(() => {
    if (!map) return;

    // Always remove existing overlay first
    if (overlayRef.current) {
      try {
        map.removeControl(overlayRef.current as unknown as any);
      } catch {
        // ignore
      }
      overlayRef.current = null;
    }

    if (!visible || !geoJsonData || geoJsonData.features.length === 0) {
      return;
    }

    const layer = new GeoJsonLayer({
      id: 'era5-air-temperature-cells',
      data: geoJsonData,
      // Polygon fill
      filled: true,
      getFillColor: (feature: any) => feature.properties.fillColor,
      // Polygon outline
      stroked: true,
      getLineColor: [80, 80, 80, 60],
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 0.5,
      // Rendering options
      opacity,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
      // No depth test for 2D overlay
      parameters: {
        depthTest: false,
      },
    });

    const overlay = new MapboxOverlay({ 
      interleaved: false, 
      layers: [layer],
    });
    
    try {
      map.addControl(overlay as unknown as any);
      overlayRef.current = overlay;
      console.log('[AirTemperatureOverlay] GeoJsonLayer added to map:', {
        cells: geoJsonData.features.length,
        opacity,
      });
    } catch (err) {
      console.error('[AirTemperatureOverlay] Failed to add overlay:', err);
    }

    return () => {
      if (overlayRef.current) {
        try {
          map.removeControl(overlayRef.current as unknown as any);
        } catch {
          // ignore
        }
        overlayRef.current = null;
      }
    };
  }, [map, visible, geoJsonData, opacity]);

  // Update opacity without re-creating the entire overlay
  useEffect(() => {
    if (!overlayRef.current || !geoJsonData) return;

    const layer = new GeoJsonLayer({
      id: 'era5-air-temperature-cells',
      data: geoJsonData,
      filled: true,
      getFillColor: (feature: any) => feature.properties.fillColor,
      stroked: true,
      getLineColor: [80, 80, 80, 60],
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 0.5,
      opacity,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
      parameters: {
        depthTest: false,
      },
    });

    overlayRef.current.setProps({ layers: [layer] });
  }, [opacity, geoJsonData]);

  return null;
}

export default AirTemperatureOverlay;
