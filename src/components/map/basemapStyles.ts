// src/components/map/basemapStyles.ts

// 1. Definiere die Konstanten
const STYLES = {
  LIGHT: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  DARK: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  SATELLITE: 'https://api.maptiler.com/maps/satellite/style.json?key=get_your_own_OpIi9ZULNHzrESv6T2vL',
};

// 2. Exportiere das Objekt sicher
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

// 3. Exportiere die Helper-Funktionen
// ACHTUNG: Hier darf KEIN "import" Fehler entstehen.
export function buildTemperatureColorExpression(min = -20, max = 40) {
  return [
    'interpolate',
    ['linear'],
    ['get', 'value'],
    min, '#2c7bb6',
    (min + max) / 2, '#ffffbf',
    max, '#d7191c'
  ];
}

export function getTemperatureColor(value: number, min = -20, max = 40) {
  if (value <= min) return '#2c7bb6';
  if (value >= max) return '#d7191c';
  return '#ffffbf'; // Fallback Mitte
}
