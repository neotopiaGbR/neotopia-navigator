/**
 * Map Style Definitions & Color Utilities
 * ARCHITECT NOTE: Includes strict type safety and fallbacks.
 */

const STYLES = {
  LIGHT: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  DARK: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  SATELLITE: 'https://api.maptiler.com/maps/satellite/style.json?key=get_your_own_OpIi9ZULNHzrESv6T2vL',
};

// Export with aliasing to prevent case-sensitivity crashes
export const MAP_STYLES = {
  ...STYLES,
  light: STYLES.LIGHT,
  dark: STYLES.DARK,
  satellite: STYLES.SATELLITE,
  Light: STYLES.LIGHT,
  Dark: STYLES.DARK,
  Satellite: STYLES.SATELLITE,
};

export const DEFAULT_COLOR = '#cccccc';

/**
 * Robust color interpolation for Deck.gl and MapLibre
 */
export function buildTemperatureColorExpression(min: number = -20, max: number = 40): any[] {
  // Safety clamp to prevent inversion
  const safeMin = min >= max ? max - 10 : min;
  const safeMax = max <= min ? min + 10 : max;
  
  const range = safeMax - safeMin;
  const step = range / 5;

  return [
    'interpolate',
    ['linear'],
    ['get', 'value'],
    safeMin, '#2c7bb6',        // Deep Blue
    safeMin + step, '#abd9e9', // Light Blue
    safeMin + step * 2.5, '#ffffbf', // Yellow/Cream
    safeMin + step * 4, '#fdae61',   // Orange
    safeMax, '#d7191c'         // Deep Red
  ];
}

/**
 * JS-side color interpolation helper
 */
export function getTemperatureColor(value: number, min: number = -20, max: number = 40): string {
  if (value <= min) return '#2c7bb6';
  if (value >= max) return '#d7191c';
  
  const t = (value - min) / (max - min);
  
  if (t < 0.5) {
    return interpolateColor('#2c7bb6', '#ffffbf', t * 2);
  } else {
    return interpolateColor('#ffffbf', '#d7191c', (t - 0.5) * 2);
  }
}

function interpolateColor(c1: string, c2: string, f: number): string {
  if (typeof window === 'undefined') return c1;
  const rgb1 = hexToRgb(c1);
  const rgb2 = hexToRgb(c2);
  const r = Math.round(rgb1[0] + f * (rgb2[0] - rgb1[0]));
  const g = Math.round(rgb1[1] + f * (rgb2[1] - rgb1[1]));
  const b = Math.round(rgb1[2] + f * (rgb2[2] - rgb1[2]));
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result 
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] 
    : [0, 0, 0];
}
