/**
 * Map Style Definitions & Color Utilities
 */

// Standard Map Styles (Light/Dark/Satellite)
export const MAP_STYLES = {
  LIGHT: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  DARK: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  SATELLITE: 'https://api.maptiler.com/maps/satellite/style.json?key=get_your_own_OpIi9ZULNHzrESv6T2vL',
};

// Fallback color if something goes wrong
export const DEFAULT_COLOR = '#ccc';

/**
 * Erstellt einen Mapbox-GL Style Expression für Temperaturfarben.
 * Skala: Blau (kalt) -> Gelb -> Rot (heiß)
 */
export function buildTemperatureColorExpression(min: number = -20, max: number = 40): any[] {
  // Sicherstellen, dass Min < Max ist, um Fehler zu vermeiden
  const safeMin = min >= max ? max - 10 : min;
  const safeMax = max <= min ? min + 10 : max;
  
  // Berechne Zwischenschritte für einen sanften Farbverlauf
  const range = safeMax - safeMin;
  const step = range / 5;

  return [
    'interpolate',
    ['linear'],
    ['get', 'value'],
    // Extrem Kalt (Dunkelblau)
    safeMin, '#2c7bb6',
    // Kalt (Hellblau)
    safeMin + step, '#abd9e9',
    // Mild (Gelb/Creme)
    safeMin + step * 2.5, '#ffffbf',
    // Warm (Orange)
    safeMin + step * 4, '#fdae61',
    // Heiß (Rot)
    safeMax, '#d7191c'
  ];
}

/**
 * Gibt die CSS-Farbe für einen bestimmten Temperaturwert zurück (für Legenden etc.)
 */
export function getTemperatureColor(value: number, min: number = -20, max: number = 40): string {
  // Einfache Approximation für JS-seitige Farbgebung
  if (value <= min) return '#2c7bb6';
  if (value >= max) return '#d7191c';
  
  const t = (value - min) / (max - min);
  
  // Simple Interpolation zwischen Blau und Rot über Gelb
  if (t < 0.5) {
    // Blau zu Gelb (0.0 bis 0.5 -> 0.0 bis 1.0)
    return interpolateColor('#2c7bb6', '#ffffbf', t * 2);
  } else {
    // Gelb zu Rot (0.5 bis 1.0 -> 0.0 bis 1.0)
    return interpolateColor('#ffffbf', '#d7191c', (t - 0.5) * 2);
  }
}

// Hilfsfunktion für einfache JS-Farbinterpolation (RGB)
function interpolateColor(color1: string, color2: string, factor: number): string {
  if (typeof window === 'undefined') return color1; // SSR check
  
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
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  ] : [0, 0, 0];
}
