/**
 * Risk Layers Configuration - Virtual Tiling Edition
 * 
 * Centralized configuration for heavy rain risk visualization layers.
 * Supports Cloud-Native formats (COG, PMTiles) for efficient streaming.
 * 
 * Data sources: DWD KOSTRA-DWD-2020 and CatRaRE.
 */

// ============================================================================
// STORAGE CONFIGURATION
// ============================================================================

/**
 * Base URL for Supabase Storage.
 * Update this after uploading data to your Supabase project.
 */
export const STORAGE_BASE_URL = 'https://bxchawikvnvxzerlsffs.supabase.co/storage/v1/object/public/risk-layers';

/**
 * Storage paths for different data types
 */
export const STORAGE_PATHS = {
  kostra: `${STORAGE_BASE_URL}/kostra`,
  catrare: `${STORAGE_BASE_URL}/catrare`,
} as const;

// ============================================================================
// KOSTRA CONFIGURATION (Precipitation Intensity - COG)
// ============================================================================

/**
 * Available precipitation durations in KOSTRA data
 */
export type KostraDuration = '60min' | '12h' | '24h';

/**
 * Available return periods in KOSTRA data
 */
export type KostraReturnPeriod = '10a' | '100a';

/**
 * KOSTRA scenario configuration
 */
export interface KostraScenario {
  duration: KostraDuration;
  returnPeriod: KostraReturnPeriod;
}

/**
 * Human-readable labels for durations
 */
export const KOSTRA_DURATION_LABELS: Record<KostraDuration, string> = {
  '60min': '1 Stunde',
  '12h': '12 Stunden',
  '24h': '24 Stunden',
};

/**
 * Human-readable labels for return periods
 */
export const KOSTRA_RETURN_PERIOD_LABELS: Record<KostraReturnPeriod, string> = {
  '10a': '10 Jahre',
  '100a': '100 Jahre',
};

/**
 * Get the PMTiles file URL for a KOSTRA scenario.
 * PMTiles support HTTP Range Requests for serverless vector tile serving.
 */
export function getKostraPmtilesUrl(duration: KostraDuration, returnPeriod: KostraReturnPeriod): string {
  // Duration format: 60min -> 60, 12h -> 720, 24h -> 1440 (minutes)
  const durationMinutes = duration === '60min' ? '60' : duration === '12h' ? '720' : '1440';
  // Return period format: 10a -> 10, 100a -> 100
  const returnYears = returnPeriod.replace('a', '');
  return `${STORAGE_PATHS.kostra}/kostra_d${durationMinutes}_t${returnYears}.pmtiles`;
}

/**
 * Default KOSTRA scenario (24h, 100-year return)
 */
export const DEFAULT_KOSTRA_SCENARIO: KostraScenario = {
  duration: '24h',
  returnPeriod: '100a',
};

/**
 * KOSTRA precipitation intensity color scale (mm)
 * Blue-Purple gradient for rain intensity
 */
export const KOSTRA_COLOR_SCALE: Array<{ value: number; color: string; label: string }> = [
  { value: 0, color: '#e0f3ff', label: '0 mm' },
  { value: 20, color: '#a6d4ff', label: '20 mm' },
  { value: 40, color: '#6bb3ff', label: '40 mm' },
  { value: 60, color: '#3d8bff', label: '60 mm' },
  { value: 80, color: '#2166cc', label: '80 mm' },
  { value: 100, color: '#5c3d99', label: '100 mm' },
  { value: 150, color: '#8b1a8b', label: '≥150 mm' },
];

// ============================================================================
// CATRARE CONFIGURATION (Historical Events - PMTiles)
// ============================================================================

/**
 * Warning levels in CatRaRE data
 */
export type CatrareWarningLevel = 1 | 2 | 3 | 4;

/**
 * CatRaRE event properties from vector tiles
 */
export interface CatrareEventProperties {
  ID: string;
  DATUM: number;  // YYYYMMDD format
  ANFANG: string; // Start time
  ENDE: string;   // End time
  DAUER_H: number; // Duration in hours
  N_MAX: number;  // Maximum precipitation (mm)
  N_SUMME: number; // Total precipitation (mm)
  WARNSTUFE: CatrareWarningLevel;
  FLAECHE_KM2: number;
}

/**
 * Get the PMTiles URL for CatRaRE data.
 * PMTiles support HTTP Range Requests for serverless vector tile serving.
 */
export function getCatrarePmtilesUrl(): string {
  return `${STORAGE_PATHS.catrare}/catrare.pmtiles`;
}

/**
 * Get the GeoJSON fallback URL for CatRaRE data.
 * Used when PMTiles loading fails or for simplified rendering.
 */
export function getCatrareGeoJsonUrl(): string {
  return `${STORAGE_PATHS.catrare}/catrare_recent.json`;
}

/**
 * Color scale for CatRaRE warning levels (DWD standard colors)
 */
export const CATRARE_WARNING_COLORS: Record<CatrareWarningLevel, string> = {
  1: '#FFD700', // Yellow - Minor
  2: '#FFA500', // Orange - Moderate
  3: '#FF4500', // Red-Orange - Severe (Unwetter)
  4: '#8B0000', // Dark Red - Extreme
};

/**
 * Labels for CatRaRE warning levels
 */
export const CATRARE_WARNING_LABELS: Record<CatrareWarningLevel, string> = {
  1: 'Leicht',
  2: 'Mäßig',
  3: 'Stark (Unwetter)',
  4: 'Extrem',
};

// ============================================================================
// ATTRIBUTION
// ============================================================================

export const RISK_LAYER_ATTRIBUTION = {
  kostra: {
    name: 'Starkregen-Potenzial (KOSTRA)',
    fullName: 'KOSTRA-DWD-2020',
    source: 'Deutscher Wetterdienst (DWD)',
    license: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
    url: 'https://opendata.dwd.de/climate_environment/CDC/grids_germany/return_periods/precipitation/KOSTRA/',
    description: 'Statistisch ermittelte Starkniederschlagshöhen für verschiedene Dauerstufen und Wiederkehrperioden.',
    short: 'Quelle: DWD, KOSTRA-DWD-2020',
  },
  catrare: {
    name: 'Historische Ereignisse (CatRaRE)',
    fullName: 'CatRaRE - Catalogue of Radar-based Heavy Rainfall Events',
    source: 'Deutscher Wetterdienst (DWD)',
    license: 'CC BY 4.0',
    url: 'https://opendata.dwd.de/climate_environment/CDC/grids_germany/hourly/radolan/CatRaRE/',
    description: 'Katalog radarbasierter Starkregenereignisse in Deutschland.',
    short: 'Quelle: DWD, CatRaRE v2023.01',
  },
} as const;

// ============================================================================
// LAYER INFO FOR UI
// ============================================================================

export const RISK_OVERLAY_INFO = {
  kostra: {
    name: 'Starkregen-Potenzial (KOSTRA)',
    description: 'Statistisch ermittelte Niederschlagshöhen nach KOSTRA-DWD-2020. Zeigt das Gefährdungspotenzial für verschiedene Dauerstufen und Wiederkehrperioden.',
    attribution: RISK_LAYER_ATTRIBUTION.kostra.short,
    legendLabel: 'Niederschlagshöhe (mm)',
    legendColors: KOSTRA_COLOR_SCALE.map(s => ({ color: s.color, label: s.label })),
    tooltipNote: 'Diese Karte zeigt das statistische Starkregen-Potenzial, keine aktuellen Niederschläge.',
  },
  catrare: {
    name: 'Historische Starkregenereignisse',
    description: 'Dokumentierte Starkregenereignisse der letzten 10 Jahre (CatRaRE). Zeigt Gebiete, die von schweren Niederschlägen betroffen waren.',
    attribution: RISK_LAYER_ATTRIBUTION.catrare.short,
    legendLabel: 'Warnstufe',
    legendColors: [
      { color: CATRARE_WARNING_COLORS[1], label: 'Leicht' },
      { color: CATRARE_WARNING_COLORS[2], label: 'Mäßig' },
      { color: CATRARE_WARNING_COLORS[3], label: 'Stark' },
      { color: CATRARE_WARNING_COLORS[4], label: 'Extrem' },
    ],
    tooltipNote: 'Zeigt historische Ereignisse, kein Echtzeit-Warnstatus.',
  },
} as const;

// ============================================================================
// DEFAULT LAYER STATE
// ============================================================================

export interface RiskLayerState {
  kostraEnabled: boolean;
  kostraOpacity: number;
  kostraDuration: KostraDuration;
  kostraReturnPeriod: KostraReturnPeriod;
  catrareEnabled: boolean;
  catrareOpacity: number;
}

export const DEFAULT_RISK_LAYER_STATE: RiskLayerState = {
  kostraEnabled: false,
  kostraOpacity: 70,
  kostraDuration: '24h',
  kostraReturnPeriod: '100a',
  catrareEnabled: false,
  catrareOpacity: 60,
};
