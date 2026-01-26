// Climate Projection Module Types

export type ClimateScenario = 'baseline' | 'ssp126' | 'ssp245' | 'ssp585';

export type ClimateTimeHorizon = 'baseline' | '2031-2060' | '2071-2100';

export interface ClimateScenarioOption {
  value: ClimateScenario;
  label: string;
  description: string;
}

export interface ClimateTimeHorizonOption {
  value: ClimateTimeHorizon;
  label: string;
  periodStart: number;
  periodEnd: number;
}

export const CLIMATE_SCENARIOS: ClimateScenarioOption[] = [
  {
    value: 'baseline',
    label: 'Baseline',
    description: 'Referenzperiode 1991–2020',
  },
  {
    value: 'ssp126',
    label: 'SSP1-2.6',
    description: 'Nachhaltige Entwicklung, starke Klimaschutzmaßnahmen',
  },
  {
    value: 'ssp245',
    label: 'SSP2-4.5',
    description: 'Mittlerer Pfad, moderate Maßnahmen',
  },
  {
    value: 'ssp585',
    label: 'SSP5-8.5',
    description: 'Fossile Entwicklung, keine Klimaschutzmaßnahmen',
  },
];

export const CLIMATE_TIME_HORIZONS: ClimateTimeHorizonOption[] = [
  {
    value: 'baseline',
    label: '1991–2020',
    periodStart: 1991,
    periodEnd: 2020,
  },
  {
    value: '2031-2060',
    label: '2031–2060',
    periodStart: 2031,
    periodEnd: 2060,
  },
  {
    value: '2071-2100',
    label: '2071–2100',
    periodStart: 2071,
    periodEnd: 2100,
  },
];

// Climate indicator definitions
export interface ClimateIndicatorDefinition {
  code: string;
  name: string;
  unit: string;
  category: 'heat' | 'extremes' | 'water';
  description: string;
  higherIsBetter: boolean;
}

export const CLIMATE_INDICATORS: ClimateIndicatorDefinition[] = [
  // Heat & Comfort
  {
    code: 'mean_annual_temperature',
    name: 'Jahresmitteltemperatur',
    unit: '°C',
    category: 'heat',
    description: 'Durchschnittliche Jahrestemperatur',
    higherIsBetter: false,
  },
  {
    code: 'hot_days_30c',
    name: 'Heiße Tage (≥30°C)',
    unit: 'Tage/Jahr',
    category: 'heat',
    description: 'Tage mit Maximaltemperatur ≥ 30°C',
    higherIsBetter: false,
  },
  {
    code: 'tropical_nights_20c',
    name: 'Tropennächte (≥20°C)',
    unit: 'Nächte/Jahr',
    category: 'heat',
    description: 'Nächte mit Minimaltemperatur ≥ 20°C',
    higherIsBetter: false,
  },
  {
    code: 'tx95p',
    name: 'Extremtemperatur (95. Perzentil)',
    unit: '°C',
    category: 'heat',
    description: '95. Perzentil der täglichen Maximaltemperatur',
    higherIsBetter: false,
  },
  // Extremes & Stress
  {
    code: 'heat_stress_index',
    name: 'Hitzestress-Index',
    unit: 'Index',
    category: 'extremes',
    description: 'Kombinierter Index für Hitzebelastung',
    higherIsBetter: false,
  },
  {
    code: 'max_consecutive_hot_days',
    name: 'Max. aufeinanderfolgende Hitzetage',
    unit: 'Tage',
    category: 'extremes',
    description: 'Längste Serie aufeinanderfolgender heißer Tage',
    higherIsBetter: false,
  },
  // Water & Dryness
  {
    code: 'summer_precipitation_change',
    name: 'Sommerniederschlag (Änderung)',
    unit: '%',
    category: 'water',
    description: 'Prozentuale Änderung des Sommerniederschlags vs. Baseline',
    higherIsBetter: true,
  },
  {
    code: 'consecutive_dry_days',
    name: 'Aufeinanderfolgende Trockentage',
    unit: 'Tage',
    category: 'water',
    description: 'Maximale Anzahl aufeinanderfolgender Tage ohne Niederschlag',
    higherIsBetter: false,
  },
];

// Climate analog locations
export interface ClimateAnalogLocation {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

export const CLIMATE_ANALOG_LOCATIONS: ClimateAnalogLocation[] = [
  { name: 'Rom', country: 'Italien', latitude: 41.9028, longitude: 12.4964 },
  { name: 'Marseille', country: 'Frankreich', latitude: 43.2965, longitude: 5.3698 },
  { name: 'Barcelona', country: 'Spanien', latitude: 41.3851, longitude: 2.1734 },
  { name: 'Madrid', country: 'Spanien', latitude: 40.4168, longitude: -3.7038 },
  { name: 'Mailand', country: 'Italien', latitude: 45.4642, longitude: 9.1900 },
  { name: 'Lyon', country: 'Frankreich', latitude: 45.7640, longitude: 4.8357 },
  { name: 'Bordeaux', country: 'Frankreich', latitude: 44.8378, longitude: -0.5792 },
  { name: 'Toulouse', country: 'Frankreich', latitude: 43.6047, longitude: 1.4442 },
  { name: 'Zagreb', country: 'Kroatien', latitude: 45.8150, longitude: 15.9819 },
  { name: 'Budapest', country: 'Ungarn', latitude: 47.4979, longitude: 19.0402 },
  { name: 'Wien', country: 'Österreich', latitude: 48.2082, longitude: 16.3738 },
  { name: 'Prag', country: 'Tschechien', latitude: 50.0755, longitude: 14.4378 },
];

// Climate indicator data structure
export interface ClimateIndicatorValue {
  indicator_code: string;
  value: number;
  scenario: ClimateScenario;
  period_start: number;
  period_end: number;
  is_baseline: boolean;
}

export interface ClimateIndicatorData {
  indicator: ClimateIndicatorDefinition;
  baselineValue: number | null;
  projectedValue: number | null;
  absoluteChange: number | null;
  relativeChange: number | null;
  scenario: ClimateScenario;
  timeHorizon: ClimateTimeHorizon;
}

export interface ClimateAnalogResult {
  analogLocation: ClimateAnalogLocation | null;
  similarityScore: number | null;
  description: string;
}

// Category labels
export const CLIMATE_CATEGORY_LABELS: Record<ClimateIndicatorDefinition['category'], string> = {
  heat: 'Hitze & Komfort',
  extremes: 'Extreme & Stress',
  water: 'Wasser & Trockenheit',
};
