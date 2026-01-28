/**
 * Air Temperature Overlay (2m) - Germany Summer Composite
 * 
 * Renders ERA5-Land 2m air temperature as a CONTINUOUS raster (no dots, no cells)
 * using deck.gl BitmapLayer via MapboxOverlay.
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
import { MapboxOverlay } from '@deck.gl/mapbox';
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

export function AirTemperatureOverlay({
  map,
  visible,
  opacity = 0.6,
  data,
}: AirTemperatureOverlayProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
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

  // Mount/unmount deck.gl BitmapLayer via MapboxOverlay
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

    if (!visible || !imageUrl || !bounds) return;

    const layer = new BitmapLayer({
      id: 'era5-air-temperature-raster',
      bounds: [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat],
      image: imageUrl,
      opacity,
      pickable: false,
      parameters: { depthTest: false },
    });

    const overlay = new MapboxOverlay({ interleaved: false, layers: [layer] });
    try {
      map.addControl(overlay as unknown as any);
      overlayRef.current = overlay;
      console.log('[AirTemperatureOverlay] BitmapLayer added to map, bounds:', bounds);
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
  }, [map, visible, imageUrl, bounds, opacity]);

  return null;
}

export default AirTemperatureOverlay;
