import { clamp01, colorForT, lerp } from './colorScale';
import type { MultiPolygon } from './types';
import { pointInMultiPolygon } from './mask';

export function createCanvasDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function rasterizeAirTemperatureToDataUrl(params: {
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  grid: Array<{ lat: number; lon: number; value: number }>;
  normalization: { p5: number; p95: number };
  germanyMask?: MultiPolygon | null;
  width?: number;
  height?: number;
  stepDeg?: number;
}) {
  const {
    bounds,
    grid,
    normalization,
    germanyMask,
    width = 640,
    height = 640,
    stepDeg = 0.1,
  } = params;

  const img = new ImageData(width, height);
  const { p5, p95 } = normalization;
  const range = p95 - p5 || 1;

  // Build a regular node grid (0.1°) for bilinear sampling
  const lats: number[] = [];
  const lons: number[] = [];
  for (let lat = bounds.minLat; lat <= bounds.maxLat + 1e-9; lat += stepDeg) lats.push(Math.round(lat * 100) / 100);
  for (let lon = bounds.minLon; lon <= bounds.maxLon + 1e-9; lon += stepDeg) lons.push(Math.round(lon * 100) / 100);

  const key = (lat: number, lon: number) => `${lat.toFixed(2)}|${lon.toFixed(2)}`;
  const values = new Map<string, number>();
  for (const p of grid) values.set(key(p.lat, p.lon), p.value);

  // Robust fill: expand search radius until a value is found.
  // This avoids “all-transparent” rasters when backend sampling is sparse/irregular.
  const maxR = Math.max(20, Math.floor(Math.max(lats.length, lons.length) * 0.1));
  const getFilled = (lat: number, lon: number): number => {
    const direct = values.get(key(lat, lon));
    if (direct != null) return direct;

    const latIdx = Math.round((lat - bounds.minLat) / stepDeg);
    const lonIdx = Math.round((lon - bounds.minLon) / stepDeg);

    for (let r = 1; r <= maxR; r++) {
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

    // Absolute fallback (should rarely happen): render p5 rather than nothing.
    return p5;
  };

  const gridVals: number[][] = new Array(lats.length);
  for (let i = 0; i < lats.length; i++) {
    gridVals[i] = new Array(lons.length);
    for (let j = 0; j < lons.length; j++) {
      gridVals[i][j] = getFilled(lats[i], lons[j]);
    }
  }

  const hasMask = !!germanyMask;

  let transparent = 0;
  // Bilinear sample on the filled regular grid
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const lat = lerp(bounds.maxLat, bounds.minLat, v); // top->bottom

    const fi = (lat - bounds.minLat) / stepDeg;
    const i0 = Math.floor(fi);
    const i1 = Math.min(i0 + 1, lats.length - 1);
    const ty = clamp01(fi - i0);

    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const lon = lerp(bounds.minLon, bounds.maxLon, u);

      if (hasMask && germanyMask && !pointInMultiPolygon(lon, lat, germanyMask)) {
        const idx = (y * width + x) * 4;
        img.data[idx + 3] = 0;
        transparent++;
        continue;
      }

      const fj = (lon - bounds.minLon) / stepDeg;
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

  const url = createCanvasDataUrl(img);
  const total = width * height;
  return {
    url,
    stats: {
      width,
      height,
      transparentPct: Math.round((transparent / total) * 1000) / 10,
      samplePoints: grid.length,
      nodeGrid: `${lats.length}x${lons.length}`,
    },
  };
}
