/**
 * Convert ERA5 grid points to GeoJSON FeatureCollection with 0.1° cell polygons.
 * 
 * Each grid point becomes a square cell polygon centered on the lat/lon.
 * Color is computed from the value using percentile normalization (P5-P95).
 */

export interface GridPoint {
  lat: number;
  lon: number;
  value: number;
}

export interface Normalization {
  p5: number;
  p95: number;
  min: number;
  max: number;
}

export interface GridCellFeature {
  type: 'Feature';
  properties: {
    value: number;
    valueCelsius: string;
    fillColor: [number, number, number, number]; // RGBA
    t: number; // Normalized 0-1
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

/**
 * Perceptual color scale: blue → cyan → green → yellow → orange → red
 * Designed for temperature visualization with good contrast
 */
const COLOR_STOPS: Array<{ t: number; rgba: [number, number, number, number] }> = [
  { t: 0.0, rgba: [49, 54, 149, 200] },    // Deep blue (cold)
  { t: 0.2, rgba: [69, 117, 180, 210] },   // Blue
  { t: 0.35, rgba: [116, 173, 209, 220] }, // Cyan-blue
  { t: 0.5, rgba: [171, 217, 233, 230] },  // Light cyan
  { t: 0.6, rgba: [254, 224, 144, 235] },  // Light yellow
  { t: 0.75, rgba: [253, 174, 97, 240] },  // Orange
  { t: 0.9, rgba: [244, 109, 67, 245] },   // Orange-red
  { t: 1.0, rgba: [215, 48, 39, 255] },    // Red (hot)
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function colorForT(t: number): [number, number, number, number] {
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

/**
 * Create a 0.1° cell polygon centered on (lat, lon)
 */
function createCellPolygon(lat: number, lon: number, halfStep: number = 0.05): number[][][] {
  // Cell corners: [lon, lat] pairs forming a closed ring
  return [[
    [lon - halfStep, lat - halfStep], // SW
    [lon + halfStep, lat - halfStep], // SE
    [lon + halfStep, lat + halfStep], // NE
    [lon - halfStep, lat + halfStep], // NW
    [lon - halfStep, lat - halfStep], // Close ring
  ]];
}

/**
 * Convert grid points to GeoJSON FeatureCollection
 */
export function gridToGeoJson(
  grid: GridPoint[],
  normalization: Normalization,
  cellSizeDeg: number = 0.1
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const halfStep = cellSizeDeg / 2;
  const { p5, p95 } = normalization;
  const range = p95 - p5 || 1;

  const features: GridCellFeature[] = grid.map((point) => {
    const t = clamp01((point.value - p5) / range);
    const fillColor = colorForT(t);

    return {
      type: 'Feature' as const,
      properties: {
        value: point.value,
        valueCelsius: `${point.value.toFixed(1)}°C`,
        fillColor,
        t,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: createCellPolygon(point.lat, point.lon, halfStep),
      },
    };
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Generate legend entries matching the color scale
 */
export function getLegendEntries(normalization: Normalization): Array<{ color: string; label: string }> {
  const { p5, p95 } = normalization;
  const range = p95 - p5;
  
  // Create 6 evenly spaced entries
  const entries: Array<{ color: string; label: string }> = [];
  const steps = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  
  for (const t of steps) {
    const [r, g, b] = colorForT(t);
    const temp = p5 + t * range;
    entries.push({
      color: `rgb(${r}, ${g}, ${b})`,
      label: `${temp.toFixed(0)}°C`,
    });
  }
  
  return entries;
}
