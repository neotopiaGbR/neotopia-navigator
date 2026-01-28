/**
 * Air Temperature Overlay (2m) - Germany Summer Composite
 * 
 * Renders ERA5-Land 2m air temperature as a CONTINUOUS raster (no dots, no cells)
 * using deck.gl BitmapLayer.
 *
 * Implementation notes:
 * - Client-side rasterization to a fixed grid over Germany bounds
 * - Bilinear interpolation on a regular lon/lat grid (filled from sampled points)
 * - Germany mask applied so there are no square edges
 * - Single Germany-wide normalization (P5–P95) coming from the backend
 * 
 * This layer provides regional thermal context (~9 km resolution) and sits
 * BELOW the high-resolution ECOSTRESS LST hotspot layer.
 * 
 * Data source: Copernicus ERA5-Land via Open-Meteo Archive API
 * License: CC BY 4.0 (Copernicus Climate Change Service)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
// NOTE: @deck.gl/mapbox only exports MapboxOverlay from its package entry.
// MapboxLayer is available as an internal module.
import MapboxLayer from '@deck.gl/mapbox/dist/mapbox-layer';
import { BitmapLayer } from '@deck.gl/layers';
import { AirTemperatureData } from './MapLayersContext';
import germanyBoundaryUrl from '@/assets/germany-boundary.json?url';
import type { MultiPolygon, Ring } from './airTemperature/types';
import { rasterizeAirTemperatureToDataUrl } from './airTemperature/rasterize';

interface AirTemperatureOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  data: AirTemperatureData | null;
}

const LAYER_ID = 'era5-air-temperature-raster';

export function AirTemperatureOverlay({
  map,
  visible,
  opacity = 0.6,
  data,
}: AirTemperatureOverlayProps) {
  const layerRef = useRef<MapboxLayer | null>(null);
  const boundaryRef = useRef<MultiPolygon | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const bounds = useMemo(() => {
    if (!data) return null;
    const [minLon, minLat, maxLon, maxLat] = data.bounds;
    return { minLon, minLat, maxLon, maxLat };
  }, [data]);

  // Load Germany boundary once
  useEffect(() => {
    let cancelled = false;
    if (boundaryRef.current) return;
    fetch(germanyBoundaryUrl)
      .then((r) => r.json())
      .then((gj) => {
        if (cancelled) return;
        // Handle both FeatureCollection and bare geometry
        let geom = gj?.geometry;
        if (!geom && gj?.features?.[0]?.geometry) {
          geom = gj.features[0].geometry;
        }
        if (!geom) {
          console.warn('[AirTemperatureOverlay] No geometry found in boundary file');
          return;
        }
        if (geom.type === 'Polygon') {
          boundaryRef.current = [geom.coordinates as Ring[]];
        } else if (geom.type === 'MultiPolygon') {
          boundaryRef.current = geom.coordinates as MultiPolygon;
        }
        console.log('[AirTemperatureOverlay] Germany boundary loaded:', geom.type);
      })
      .catch((err) => {
        console.warn('[AirTemperatureOverlay] Failed to load boundary:', err);
        // If boundary fails, we still render the raster in bbox (no blocking)
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rasterize to an image whenever data changes
  useEffect(() => {
    if (!visible || !data || !bounds) {
      setImageUrl(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      const germany = boundaryRef.current;
      const { url, stats } = rasterizeAirTemperatureToDataUrl({
        bounds,
        grid: data.grid,
        normalization: data.normalization,
        germanyMask: germany,
        width: 640,
        height: 640,
        stepDeg: 0.1,
      });

      if (cancelled) return;
      console.log('[AirTemperatureOverlay] Raster created:', {
        urlBytes: url.length,
        ...stats,
        hasMask: !!germany,
      });
      if (!cancelled) setImageUrl(url);
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [visible, data, bounds]);

  // Mount/unmount deck.gl layer (MapboxLayer integration = reliable z-order in MapLibre)
  useEffect(() => {
    if (!map) return;
    const addOrUpdate = () => {
      if (!visible || !imageUrl || !bounds) {
        if (map.getLayer(LAYER_ID)) {
          try {
            map.removeLayer(LAYER_ID);
          } catch {
            // ignore
          }
        }
        layerRef.current = null;
        return;
      }

      const beforeId = map.getLayer('regions-fill') ? 'regions-fill' : undefined;

      // If style reload removed it, layerRef may be stale: always check map.getLayer
      if (!map.getLayer(LAYER_ID)) {
        const mbLayer = new MapboxLayer({
          id: LAYER_ID,
          type: BitmapLayer,
          bounds: [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat],
          image: imageUrl,
          opacity,
          pickable: false,
          parameters: { depthTest: false },
        } as any);

        try {
          map.addLayer(mbLayer as unknown as any, beforeId);
          layerRef.current = mbLayer;
          console.log('[AirTemperatureOverlay] MapboxLayer added:', { beforeId, bounds });
        } catch (err) {
          console.error('[AirTemperatureOverlay] Failed to add MapboxLayer:', err);
        }
      } else if (layerRef.current) {
        try {
          layerRef.current.setProps({
            bounds: [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat],
            image: imageUrl,
            opacity,
          } as any);
        } catch (err) {
          console.warn('[AirTemperatureOverlay] Failed to update layer props:', err);
        }
      }
    };

    addOrUpdate();

    const onStyleLoad = () => addOrUpdate();
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
      if (map.getLayer(LAYER_ID)) {
        try {
          map.removeLayer(LAYER_ID);
        } catch {
          // ignore
        }
      }
      layerRef.current = null;
    };
  }, [map, visible, imageUrl, bounds, opacity]);

  return null;
}

export default AirTemperatureOverlay;
