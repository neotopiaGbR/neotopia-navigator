// Basis-URL für Supabase Storage Bucket
export const STORAGE_BASE_URL = 'https://bxchawikvnvxzerlsffs.supabase.co/storage/v1/object/public/risk-layers';

// Dateien liegen im Root, daher ist der Pfad gleich der Base-URL
export const STORAGE_PATHS = {
  kostra: STORAGE_BASE_URL,
  catrare: STORAGE_BASE_URL,
} as const;

export type KostraDuration = '60min' | '12h' | '24h';
export type KostraReturnPeriod = '10a' | '100a';

export interface KostraScenario {
  duration: KostraDuration;
  returnPeriod: KostraReturnPeriod;
}

export const KOSTRA_DURATION_LABELS: Record<KostraDuration, string> = {
  '60min': '1 Stunde',
  '12h': '12 Stunden',
  '24h': '24 Stunden',
};

export const KOSTRA_RETURN_PERIOD_LABELS: Record<KostraReturnPeriod, string> = {
  '10a': '10 Jahre',
  '100a': '100 Jahre',
};

export function getKostraPmtilesUrl(duration: KostraDuration, returnPeriod: KostraReturnPeriod): string {
  // PMTiles-Datei für D60/T100 enthält alle Attribute
  return `${STORAGE_PATHS.kostra}/kostra_d60_t100.pmtiles`;
}

export const DEFAULT_KOSTRA_SCENARIO: KostraScenario = {
  duration: '60min',
  returnPeriod: '100a',
};

// Farbskala für Niederschlag (mm)
export const KOSTRA_COLOR_SCALE: Array<{ value: number; color: string; label: string }> = [
  { value: 0, color: '#e0f3ff', label: '0 mm' },
  { value: 20, color: '#a6d4ff', label: '20 mm' },
  { value: 30, color: '#6bb3ff', label: '30 mm' },
  { value: 40, color: '#3d8bff', label: '40 mm' },
  { value: 50, color: '#2166cc', label: '50 mm' },
  { value: 60, color: '#5c3d99', label: '60 mm' },
  { value: 80, color: '#8b1a8b', label: '≥80 mm' },
];

export type CatrareWarningLevel = 1 | 2 | 3 | 4;

export interface CatrareEventProperties {
  ID: string;
  JAHR: number;
  WARNSTUFE: CatrareWarningLevel;
}

export function getCatrarePmtilesUrl(): string {
  return `${STORAGE_PATHS.catrare}/catrare_events.pmtiles`;
}

export function getCatrareGeoJsonUrl(): string {
  return `${STORAGE_PATHS.catrare}/catrare_recent.json`;
}

export const CATRARE_WARNING_COLORS: Record<CatrareWarningLevel, string> = {
  1: '#FFD700',
  2: '#FFA500',
  3: '#FF4500',
  4: '#8B0000',
};

// Attribution
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
    short: 'Quelle: DWD, CatRaRE v2025.01',
  },
} as const;

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
    description: 'Dokumentierte Starkregenereignisse (CatRaRE). Zeigt Gebiete, die von schweren Niederschlägen betroffen waren.',
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
  kostraDuration: '60min',
  kostraReturnPeriod: '100a',
  catrareEnabled: false,
  catrareOpacity: 60,
};
