/**
 * Convert DWD grid points to GeoJSON FeatureCollection with 1km cell polygons.
 * 
 * Each grid point becomes a square cell polygon centered on the lat/lon.
 * Color is computed from the value using fixed temperature thresholds
 * matching the DWD HYRAS-DE dataset typical summer ranges.
 * 
 * Color scale: blue (<18°C) → green (20°C) → yellow (24°C) → orange (27°C) → red (>30°C)
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
 * Fixed temperature color scale for DWD summer data
 * Designed for typical German summer temperatures (15-32°C range)
 * 
 * Blue → Cyan → Green → Yellow → Orange → Red
 */
const COLOR_STOPS: Array<{ temp: number; rgba: [number, number, number, number] }> = [
  { temp: 15, rgba: [49, 54, 149, 200] },    // Deep blue (cold)
  { temp: 18, rgba: [69, 117, 180, 210] },   // Blue
  { temp: 20, rgba: [116, 173, 209, 220] },  // Cyan-blue
  { temp: 22, rgba: [171, 217, 233, 230] },  // Light cyan / green-ish
  { temp: 24, rgba: [254, 224, 144, 235] },  // Light yellow
  { temp: 26, rgba: [253, 174, 97, 240] },   // Orange
  { temp: 28, rgba: [244, 109, 67, 245] },   // Orange-red
  { temp: 30, rgba: [215, 48, 39, 255] },    // Red (hot)
  { temp: 35, rgba: [165, 15, 21, 255] },    // Dark red (extreme)
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Get color for a given temperature value
 */
export function colorForTemperature(temp: number): [number, number, number, number] {
  // Find the two color stops this temperature falls between
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (temp >= a.temp && temp <= b.temp) {
      const u = (temp - a.temp) / (b.temp - a.temp || 1);
      return [
        Math.round(lerp(a.rgba[0], b.rgba[0], u)),
        Math.round(lerp(a.rgba[1], b.rgba[1], u)),
        Math.round(lerp(a.rgba[2], b.rgba[2], u)),
        Math.round(lerp(a.rgba[3], b.rgba[3], u)),
      ];
    }
  }
  
  // Below minimum
  if (temp < COLOR_STOPS[0].temp) {
    return COLOR_STOPS[0].rgba;
  }
  
  // Above maximum
  return COLOR_STOPS[COLOR_STOPS.length - 1].rgba;
}

/**
 * Normalize temperature to 0-1 range for MapLibre expression
 */
export function normalizeTemperature(temp: number, normalization: Normalization): number {
  const { p5, p95 } = normalization;
  const range = p95 - p5 || 1;
  return clamp01((temp - p5) / range);
}

/**
 * Legacy function for backward compatibility - now uses fixed temperature scale
 */
export function colorForT(t: number): [number, number, number, number] {
  // Map t (0-1) to temperature range 15-32°C
  const temp = 15 + t * 17;
  return colorForTemperature(temp);
}

/**
 * Create a cell polygon for a given lat/lon
 * Cell size is approximately 0.009° lat and variable lon based on latitude
 * (1km = ~0.009° latitude, ~0.014° longitude at 51°N)
 */
function createCellPolygon(lat: number, lon: number, cellSizeKm: number = 1): number[][][] {
  // Convert km to approximate degrees
  const latDeg = cellSizeKm / 111.32; // ~0.009° per km
  const lonDeg = cellSizeKm / (111.32 * Math.cos(lat * Math.PI / 180)); // Varies with latitude
  
  const halfLat = latDeg / 2;
  const halfLon = lonDeg / 2;
  
  // Cell corners: [lon, lat] pairs forming a closed ring
  return [[
    [lon - halfLon, lat - halfLat], // SW
    [lon + halfLon, lat - halfLat], // SE
    [lon + halfLon, lat + halfLat], // NE
    [lon - halfLon, lat + halfLat], // NW
    [lon - halfLon, lat - halfLat], // Close ring
  ]];
}

/**
 * Convert grid points to GeoJSON FeatureCollection
 */
export function gridToGeoJson(
  grid: GridPoint[],
  normalization: Normalization,
  cellSizeKm: number = 3 // Default to ~3km when sampled
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const features: GridCellFeature[] = grid.map((point) => {
    const t = normalizeTemperature(point.value, normalization);
    const fillColor = colorForTemperature(point.value);

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
        coordinates: createCellPolygon(point.lat, point.lon, cellSizeKm),
      },
    };
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Generate legend entries with fixed temperature thresholds
 */
export function getLegendEntries(normalization: Normalization): Array<{ color: string; label: string }> {
  // Use fixed temperature thresholds for consistent legend
  const temps = [16, 18, 20, 22, 24, 26, 28, 30];
  
  return temps.map(temp => {
    const [r, g, b] = colorForTemperature(temp);
    return {
      color: `rgb(${r}, ${g}, ${b})`,
      label: `${temp}°C`,
    };
  });
}

/**
 * Build MapLibre expression for fill-color based on temperature value
 */
export function buildTemperatureColorExpression(): any {
  return [
    'interpolate',
    ['linear'],
    ['get', 't'],
    0.0, 'rgb(49, 54, 149)',    // Deep blue (cold - ~15°C)
    0.15, 'rgb(69, 117, 180)',   // Blue (~18°C)
    0.3, 'rgb(116, 173, 209)',  // Cyan (~20°C)
    0.4, 'rgb(171, 217, 233)',  // Light cyan (~22°C)
    0.55, 'rgb(254, 224, 144)', // Yellow (~24°C)
    0.65, 'rgb(253, 174, 97)',  // Orange (~26°C)
    0.8, 'rgb(244, 109, 67)',   // Orange-red (~28°C)
    0.9, 'rgb(215, 48, 39)',    // Red (~30°C)
    1.0, 'rgb(165, 15, 21)',    // Dark red (>32°C)
  ];
}
