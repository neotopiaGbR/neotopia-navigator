/**
 * Map Style Definitions & Color Utilities
 * Includes fallbacks for case-sensitivity issues.
 */

const STYLES = {
  LIGHT: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  DARK: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  SATELLITE: 'https://api.maptiler.com/maps/satellite/style.json?key=get_your_own_OpIi9ZULNHzrESv6T2vL',
};

// Export with both UPPERCASE and lowercase keys to prevent crashes
export const MAP_STYLES = {
  ...STYLES,
  light: STYLES.LIGHT,
  dark: STYLES.DARK,
  satellite: STYLES.SATELLITE,
  // Common aliases
  Light: STYLES.LIGHT,
  Dark: STYLES.DARK,
  Satellite: STYLES.SATELLITE,
};

export const DEFAULT_COLOR = '#ccc';

export function buildTemperatureColorExpression(min: number = -20, max: number = 40): any[] {
  const safeMin = min >= max ? max - 10 : min;
  const safeMax = max <= min ? min + 10 : max;
  const range = safeMax - safeMin;
  const step = range / 5;

  return [
    'interpolate',
    ['linear'],
    ['get', 'value'],
    safeMin, '#2c7bb6',
    safeMin + step, '#abd9e9',
    safeMin + step * 2.5, '#ffffbf',
    safeMin + step * 4, '#fdae61',
    safeMax, '#d7191c'
  ];
}

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

function interpolateColor(color1: string, color2: string, factor: number): string {
  if (typeof window === 'undefined') return color1;
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  const result = [
    Math.round(c1[0] + factor * (c2[0] - c1[0])),
    Math.round(c1[1] + factor * (c2[1] - c1[1])),
    Math.round(c1[2] + factor * (c2[2] - c1[2]))
  ];
  return `rgb(${result.join(',')})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
}
