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
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer } from '@deck.gl/layers';
import { AirTemperatureData } from './MapLayersContext';
import germanyBoundaryUrl from '@/assets/germany-boundary.json?url';

interface AirTemperatureOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  data: AirTemperatureData | null;
}

type Ring = number[][]; // [ [lon,lat], ... ]
type MultiPolygon = Ring[][]; // [ polygon[ ring[ coord ] ] ]

const COLOR_STOPS: Array<{ t: number; rgba: [number, number, number, number] }> = [
  { t: 0.0, rgba: [70, 130, 180, 0] },
  { t: 0.1, rgba: [70, 130, 180, 120] },
  { t: 0.25, rgba: [100, 180, 160, 140] },
  { t: 0.4, rgba: [140, 200, 120, 160] },
  { t: 0.55, rgba: [200, 210, 100, 180] },
  { t: 0.7, rgba: [220, 200, 80, 200] },
  { t: 0.85, rgba: [230, 150, 60, 220] },
  { t: 1.0, rgba: [200, 80, 60, 255] },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function colorForT(t: number): [number, number, number, number] {
  const x = clamp01(t);
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (x >= a.t && x <= b.t) {
      const u = (x - a.t) / (b.t - a.t || 1);
      return [
        Math.round(lerp(a.rgba[0], b.rgba[0], u)),
        Math.round(lerp(a.rgba[1], b.rgba[1], u)),
        Math.round(lerp(a.rgba[2], b.rgba[2], u)),
        Math.round(lerp(a.rgba[3], b.rgba[3], u)),
      ];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].rgba;
}

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  // Ray casting algorithm
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, polygon: Ring[]): boolean {
  // polygon[0] = outer, polygon[1..] = holes
  if (polygon.length === 0) return false;
  if (!pointInRing(lon, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lon, lat, polygon[i])) return false;
  }
  return true;
}

function pointInMultiPolygon(lon: number, lat: number, multi: MultiPolygon): boolean {
  for (const poly of multi) {
    if (pointInPolygon(lon, lat, poly)) return true;
  }
  return false;
}

function createCanvasDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
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
        const geom = gj?.geometry;
        if (!geom) return;
        if (geom.type === 'Polygon') {
          boundaryRef.current = [geom.coordinates as Ring[]];
        } else if (geom.type === 'MultiPolygon') {
          boundaryRef.current = geom.coordinates as MultiPolygon;
        }
      })
      .catch(() => {
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
      // Target raster resolution (fixed, to avoid zoom-dependent dot artifacts)
      const width = 640;
      const height = 640;
      const img = new ImageData(width, height);

      const { p5, p95 } = data.normalization;
      const range = p95 - p5 || 1;

      // Build a regular grid at 0.1° (ERA5-Land ~9km) and fill missing samples
      const step = 0.1;
      const lats: number[] = [];
      const lons: number[] = [];
      for (let lat = bounds.minLat; lat <= bounds.maxLat + 1e-9; lat += step) lats.push(Math.round(lat * 100) / 100);
      for (let lon = bounds.minLon; lon <= bounds.maxLon + 1e-9; lon += step) lons.push(Math.round(lon * 100) / 100);

      const key = (lat: number, lon: number) => `${lat.toFixed(2)}|${lon.toFixed(2)}`;
      const values = new Map<string, number>();
      for (const p of data.grid) values.set(key(p.lat, p.lon), p.value);

      // Fill missing nodes by searching outward (keeps bilinear well-defined)
      const getFilled = (lat: number, lon: number): number | null => {
        const direct = values.get(key(lat, lon));
        if (direct != null) return direct;
        // search neighborhood up to 3 steps
        const latIdx = Math.round((lat - bounds.minLat) / step);
        const lonIdx = Math.round((lon - bounds.minLon) / step);
        for (let r = 1; r <= 3; r++) {
          for (let di = -r; di <= r; di++) {
            for (let dj = -r; dj <= r; dj++) {
              const i = latIdx + di;
              const j = lonIdx + dj;
              if (i < 0 || j < 0 || i >= lats.length || j >= lons.length) continue;
              const v = values.get(key(lats[i], lons[j]));
              if (v != null) return v;
            }
          }
        }
        return null;
      };

      const gridVals: number[][] = new Array(lats.length);
      for (let i = 0; i < lats.length; i++) {
        gridVals[i] = new Array(lons.length);
        for (let j = 0; j < lons.length; j++) {
          const v = getFilled(lats[i], lons[j]);
          gridVals[i][j] = v ?? p5;
        }
      }

      const germany = boundaryRef.current;
      const hasMask = !!germany;

      // Bilinear sample on the filled regular grid
      for (let y = 0; y < height; y++) {
        const v = y / (height - 1);
        const lat = lerp(bounds.maxLat, bounds.minLat, v); // top->bottom

        // precompute lat index
        const fi = (lat - bounds.minLat) / step;
        const i0 = Math.floor(fi);
        const i1 = Math.min(i0 + 1, lats.length - 1);
        const ty = clamp01(fi - i0);

        for (let x = 0; x < width; x++) {
          const u = x / (width - 1);
          const lon = lerp(bounds.minLon, bounds.maxLon, u);

          // mask
          if (hasMask && germany && !pointInMultiPolygon(lon, lat, germany)) {
            const idx = (y * width + x) * 4;
            img.data[idx + 3] = 0;
            continue;
          }

          const fj = (lon - bounds.minLon) / step;
          const j0 = Math.floor(fj);
          const j1 = Math.min(j0 + 1, lons.length - 1);
          const tx = clamp01(fj - j0);

          const a = gridVals[Math.max(0, Math.min(i0, lats.length - 1))][Math.max(0, Math.min(j0, lons.length - 1))];
          const b = gridVals[Math.max(0, Math.min(i0, lats.length - 1))][Math.max(0, Math.min(j1, lons.length - 1))];
          const c = gridVals[Math.max(0, Math.min(i1, lats.length - 1))][Math.max(0, Math.min(j0, lons.length - 1))];
          const d = gridVals[Math.max(0, Math.min(i1, lats.length - 1))][Math.max(0, Math.min(j1, lons.length - 1))];

          const ab = lerp(a, b, tx);
          const cd = lerp(c, d, tx);
          const value = lerp(ab, cd, ty);

          const t = clamp01((value - p5) / range);
          const [r, g, b2, a2] = colorForT(t);

          const idx = (y * width + x) * 4;
          img.data[idx + 0] = r;
          img.data[idx + 1] = g;
          img.data[idx + 2] = b2;
          img.data[idx + 3] = a2;
        }
      }

      if (cancelled) return;
      const url = createCanvasDataUrl(img);
      if (!cancelled) setImageUrl(url);
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [visible, data, bounds]);

  // Mount/unmount deck.gl BitmapLayer
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
    } catch {
      // ignore
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
