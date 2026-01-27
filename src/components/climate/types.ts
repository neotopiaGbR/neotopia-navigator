// Climate Projection Module Types - Production Version
// Copernicus CDS / EURO-CORDEX / ERA5 based

// SSP Scenarios (CMIP6/EURO-CORDEX)
export type ClimateScenario = 'historical' | 'ssp126' | 'ssp245' | 'ssp370' | 'ssp585';

// Time Slices
export type ClimateTimeHorizon = 'baseline' | 'near' | 'far';

export interface ClimateScenarioOption {
  value: ClimateScenario;
  label: string;
  description: string;
  color: string;
}

export interface ClimateTimeHorizonOption {
  value: ClimateTimeHorizon;
  label: string;
  periodStart: number;
  periodEnd: number;
}

export const CLIMATE_SCENARIOS: ClimateScenarioOption[] = [
  {
    value: 'historical',
    label: 'Baseline',
    description: 'Referenzperiode 1991–2020 (ERA5)',
    color: 'hsl(var(--muted-foreground))',
  },
  {
    value: 'ssp126',
    label: 'SSP1-2.6',
    description: 'Nachhaltige Entwicklung, starke Klimaschutzmaßnahmen',
    color: 'hsl(142 76% 36%)',
  },
  {
    value: 'ssp245',
    label: 'SSP2-4.5',
    description: 'Mittlerer Pfad, moderate Maßnahmen',
    color: 'hsl(48 96% 53%)',
  },
  {
    value: 'ssp370',
    label: 'SSP3-7.0',
    description: 'Regionale Rivalität, schwache Klimapolitik',
    color: 'hsl(25 95% 53%)',
  },
  {
    value: 'ssp585',
    label: 'SSP5-8.5',
    description: 'Fossile Entwicklung, keine Klimaschutzmaßnahmen',
    color: 'hsl(0 84% 60%)',
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
    value: 'near',
    label: '2031–2060',
    periodStart: 2031,
    periodEnd: 2060,
  },
  {
    value: 'far',
    label: '2071–2100',
    periodStart: 2071,
    periodEnd: 2100,
  },
];

// Climate Indicator Categories
export type ClimateIndicatorCategory = 'temperature' | 'heat' | 'extremes' | 'precipitation' | 'drought' | 'urban' | 'analog';

// Full Climate Indicator Definition
export interface ClimateIndicatorDefinition {
  code: string;
  name: string;
  unit: string;
  category: ClimateIndicatorCategory;
  description: string;
  higherIsBetter: boolean;
  source: 'era5' | 'cordex' | 'derived';
  showDelta: boolean;
  deltaUnit?: string;
}

// Complete Climate Indicator Catalog
export const CLIMATE_INDICATORS: ClimateIndicatorDefinition[] = [
  // TEMPERATURE - BASELINE
  {
    code: 'temp_mean_annual',
    name: 'Jahresmitteltemperatur',
    unit: '°C',
    category: 'temperature',
    description: 'Durchschnittliche Jahrestemperatur (2m)',
    higherIsBetter: false,
    source: 'era5',
    showDelta: true,
    deltaUnit: '°C',
  },
  // TEMPERATURE - PROJECTIONS (returned by edge function for projection mode)
  {
    code: 'temp_mean_projection',
    name: 'Proj. Jahresmitteltemperatur',
    unit: '°C',
    category: 'temperature',
    description: 'Projizierte durchschnittliche Jahrestemperatur für den gewählten Zeitraum',
    higherIsBetter: false,
    source: 'cordex',
    showDelta: true,
    deltaUnit: '°C',
  },
  {
    code: 'temp_delta_vs_baseline',
    name: 'Erwärmung vs. Baseline',
    unit: '°C',
    category: 'temperature',
    description: 'Temperaturänderung gegenüber der Referenzperiode 1991–2020',
    higherIsBetter: false,
    source: 'cordex',
    showDelta: false,
  },
  {
    code: 'summer_mean_temperature',
    name: 'Sommermittel (JJA)',
    unit: '°C',
    category: 'temperature',
    description: 'Mitteltemperatur Juni–August',
    higherIsBetter: false,
    source: 'era5',
    showDelta: true,
    deltaUnit: '°C',
  },
  // HEAT INDICATORS (Hitze & Nächte)
  {
    code: 'summer_days_25c',
    name: 'Sommertage (≥25°C)',
    unit: 'Tage/Jahr',
    category: 'heat',
    description: 'Tage mit Maximaltemperatur ≥ 25°C',
    higherIsBetter: false,
    source: 'era5',
    showDelta: true,
    deltaUnit: 'Tage',
  },
  {
    code: 'hot_days_30c',
    name: 'Heiße Tage (≥30°C)',
    unit: 'Tage/Jahr',
    category: 'heat',
    description: 'Tage mit Maximaltemperatur ≥ 30°C',
    higherIsBetter: false,
    source: 'era5',
    showDelta: true,
    deltaUnit: 'Tage',
  },
  {
    code: 'tropical_nights_20c',
    name: 'Tropennächte (≥20°C)',
    unit: 'Nächte/Jahr',
    category: 'heat',
    description: 'Nächte mit Minimaltemperatur ≥ 20°C',
    higherIsBetter: false,
    source: 'era5',
    showDelta: true,
    deltaUnit: 'Nächte',
  },
  {
    code: 'heat_wave_days',
    name: 'Hitzewellentage',
    unit: 'Tage/Jahr',
    category: 'heat',
    description: 'Tage in Hitzewellen (≥3 aufeinanderfolgende Tage mit Tmax ≥ 30°C)',
    higherIsBetter: false,
    source: 'era5',
    showDelta: true,
    deltaUnit: 'Tage',
  },
  // EXTREMES
  {
    code: 'max_daily_temperature',
    name: 'Max. Tagestemperatur',
    unit: '°C',
    category: 'extremes',
    description: 'Höchste gemessene Tagestemperatur im Jahr',
    higherIsBetter: false,
    source: 'era5',
    showDelta: true,
    deltaUnit: '°C',
  },
  {
    code: 'consecutive_dry_days',
    name: 'Aufeinanderfolgende Trockentage',
    unit: 'Tage',
    category: 'extremes',
    description: 'Max. Anzahl aufeinanderfolgender Tage ohne Niederschlag (< 1mm)',
    higherIsBetter: false,
    source: 'cordex',
    showDelta: true,
    deltaUnit: 'Tage',
  },
  {
    code: 'heavy_precip_days_20mm',
    name: 'Starkniederschlagstage (≥20mm)',
    unit: 'Tage/Jahr',
    category: 'extremes',
    description: 'Tage mit Niederschlag ≥ 20mm',
    higherIsBetter: false,
    source: 'cordex',
    showDelta: true,
    deltaUnit: 'Tage',
  },
  // PRECIPITATION
  {
    code: 'precip_annual',
    name: 'Jahresniederschlag',
    unit: 'mm/Jahr',
    category: 'precipitation',
    description: 'Gesamtniederschlag pro Jahr',
    higherIsBetter: true,
    source: 'era5',
    showDelta: true,
    deltaUnit: 'mm',
  },
  {
    code: 'precip_intense_20mm',
    name: 'Starkniederschlagstage (≥20mm)',
    unit: 'Tage/Jahr',
    category: 'precipitation',
    description: 'Tage mit Niederschlag ≥ 20mm',
    higherIsBetter: false,
    source: 'era5',
    showDelta: true,
    deltaUnit: 'Tage',
  },
  {
    code: 'dry_days_consecutive',
    name: 'Max. Trockenperiode',
    unit: 'Tage',
    category: 'drought',
    description: 'Max. aufeinanderfolgende Tage mit < 1mm Niederschlag',
    higherIsBetter: false,
    source: 'era5',
    showDelta: true,
    deltaUnit: 'Tage',
  },
  // LEGACY PRECIPITATION INDICATORS (keep for backward compatibility)
  {
    code: 'annual_precipitation_sum',
    name: 'Jahresniederschlag (alt)',
    unit: 'mm',
    category: 'precipitation',
    description: 'Gesamtniederschlag pro Jahr',
    higherIsBetter: true,
    source: 'era5',
    showDelta: true,
    deltaUnit: '%',
  },
  {
    code: 'summer_precipitation_change',
    name: 'Sommerniederschlag (Δ)',
    unit: '%',
    category: 'precipitation',
    description: 'Prozentuale Änderung des Sommerniederschlags vs. Baseline',
    higherIsBetter: true,
    source: 'derived',
    showDelta: false,
  },
  {
    code: 'winter_precipitation_change',
    name: 'Winterniederschlag (Δ)',
    unit: '%',
    category: 'precipitation',
    description: 'Prozentuale Änderung des Winterniederschlags vs. Baseline',
    higherIsBetter: true,
    source: 'derived',
    showDelta: false,
  },
  {
    code: 'heavy_precip_days_20mm',
    name: 'Starkniederschlagstage (alt)',
    unit: 'Tage/Jahr',
    category: 'extremes',
    description: 'Tage mit Niederschlag ≥ 20mm',
    higherIsBetter: false,
    source: 'cordex',
    showDelta: true,
    deltaUnit: 'Tage',
  },
  {
    code: 'consecutive_dry_days',
    name: 'Aufeinanderfolgende Trockentage (alt)',
    unit: 'Tage',
    category: 'extremes',
    description: 'Max. Anzahl aufeinanderfolgender Tage ohne Niederschlag (< 1mm)',
    higherIsBetter: false,
    source: 'cordex',
    showDelta: true,
    deltaUnit: 'Tage',
  },
  // URBAN HEAT / EXPOSURE
  {
    code: 'urban_heat_risk_index',
    name: 'Urbaner Hitzestress-Index',
    unit: '0–100',
    category: 'urban',
    description: 'Kombinierter Index aus Hitzetagen, Tropennächten und Versiegelung',
    higherIsBetter: false,
    source: 'derived',
    showDelta: true,
    deltaUnit: 'Punkte',
  },
  {
    code: 'heat_exposure_population_share',
    name: 'Hitzeexposition Bevölkerung',
    unit: '%',
    category: 'urban',
    description: 'Anteil der Bevölkerung mit erhöhter Hitzebelastung',
    higherIsBetter: false,
    source: 'derived',
    showDelta: true,
    deltaUnit: '%',
  },
  // CLIMATE ANALOGS
  {
    code: 'climate_analog_city',
    name: 'Klimaanalog-Stadt',
    unit: '',
    category: 'analog',
    description: 'Heutige europäische Stadt mit ähnlichem Klima',
    higherIsBetter: false,
    source: 'derived',
    showDelta: false,
  },
  {
    code: 'climate_analog_latitude_shift_km',
    name: 'Breitengrad-Verschiebung',
    unit: 'km',
    category: 'analog',
    description: 'Äquivalente Südverschiebung in km',
    higherIsBetter: false,
    source: 'derived',
    showDelta: false,
  },
];

// Climate analog reference cities with baseline climatology
export interface ClimateAnalogLocation {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  meanAnnualTemp: number; // ERA5 1991-2020
  summerMeanTemp: number; // JJA mean
  annualPrecip: number;   // mm/year
}

export const CLIMATE_ANALOG_LOCATIONS: ClimateAnalogLocation[] = [
  // Northern Europe
  { name: 'Stockholm', country: 'Schweden', latitude: 59.33, longitude: 18.07, meanAnnualTemp: 7.5, summerMeanTemp: 17.5, annualPrecip: 550 },
  { name: 'Kopenhagen', country: 'Dänemark', latitude: 55.68, longitude: 12.57, meanAnnualTemp: 9.1, summerMeanTemp: 17.8, annualPrecip: 600 },
  { name: 'Berlin', country: 'Deutschland', latitude: 52.52, longitude: 13.40, meanAnnualTemp: 10.3, summerMeanTemp: 19.2, annualPrecip: 570 },
  { name: 'Prag', country: 'Tschechien', latitude: 50.08, longitude: 14.44, meanAnnualTemp: 10.0, summerMeanTemp: 19.5, annualPrecip: 520 },
  { name: 'Wien', country: 'Österreich', latitude: 48.21, longitude: 16.37, meanAnnualTemp: 11.4, summerMeanTemp: 21.0, annualPrecip: 620 },
  { name: 'Budapest', country: 'Ungarn', latitude: 47.50, longitude: 19.04, meanAnnualTemp: 11.8, summerMeanTemp: 21.8, annualPrecip: 550 },
  { name: 'Zagreb', country: 'Kroatien', latitude: 45.81, longitude: 15.98, meanAnnualTemp: 12.0, summerMeanTemp: 22.0, annualPrecip: 850 },
  // Central/South
  { name: 'Mailand', country: 'Italien', latitude: 45.46, longitude: 9.19, meanAnnualTemp: 13.8, summerMeanTemp: 24.0, annualPrecip: 950 },
  { name: 'Lyon', country: 'Frankreich', latitude: 45.76, longitude: 4.84, meanAnnualTemp: 12.8, summerMeanTemp: 22.5, annualPrecip: 830 },
  { name: 'Bordeaux', country: 'Frankreich', latitude: 44.84, longitude: -0.58, meanAnnualTemp: 13.5, summerMeanTemp: 21.5, annualPrecip: 950 },
  { name: 'Toulouse', country: 'Frankreich', latitude: 43.60, longitude: 1.44, meanAnnualTemp: 13.8, summerMeanTemp: 22.0, annualPrecip: 650 },
  { name: 'Marseille', country: 'Frankreich', latitude: 43.30, longitude: 5.37, meanAnnualTemp: 15.2, summerMeanTemp: 24.0, annualPrecip: 550 },
  { name: 'Barcelona', country: 'Spanien', latitude: 41.39, longitude: 2.17, meanAnnualTemp: 16.0, summerMeanTemp: 24.5, annualPrecip: 620 },
  { name: 'Rom', country: 'Italien', latitude: 41.90, longitude: 12.50, meanAnnualTemp: 16.0, summerMeanTemp: 25.5, annualPrecip: 800 },
  { name: 'Madrid', country: 'Spanien', latitude: 40.42, longitude: -3.70, meanAnnualTemp: 14.8, summerMeanTemp: 25.0, annualPrecip: 420 },
  { name: 'Lissabon', country: 'Portugal', latitude: 38.72, longitude: -9.14, meanAnnualTemp: 17.0, summerMeanTemp: 23.5, annualPrecip: 700 },
  { name: 'Sevilla', country: 'Spanien', latitude: 37.39, longitude: -5.98, meanAnnualTemp: 18.5, summerMeanTemp: 28.0, annualPrecip: 540 },
  { name: 'Athen', country: 'Griechenland', latitude: 37.98, longitude: 23.73, meanAnnualTemp: 18.5, summerMeanTemp: 28.0, annualPrecip: 400 },
];

// Category display labels
export const CLIMATE_CATEGORY_LABELS: Record<ClimateIndicatorCategory, string> = {
  temperature: 'Temperatur',
  heat: 'Hitze & Nächte',
  extremes: 'Extreme',
  precipitation: 'Niederschlag',
  drought: 'Trockenheit',
  urban: 'Urbane Hitze',
  analog: 'Klimaanalogie',
};

// Climate indicator data structures
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
  latitudeShiftKm: number | null;
  similarityScore: number | null;
  description: string;
}

// Data attribution for Copernicus
export const CLIMATE_DATA_ATTRIBUTION = {
  baseline: {
    source: 'Copernicus Climate Change Service (C3S)',
    dataset: 'ERA5-Land hourly data',
    period: '1991–2020',
    license: 'CC BY 4.0',
    url: 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/reanalysis-era5-land',
  },
  projections: {
    source: 'Open-Meteo Climate API',
    dataset: 'CMIP6 climate projections (IPCC AR6 scenarios)',
    scenarios: ['SSP1-2.6', 'SSP2-4.5', 'SSP3-7.0', 'SSP5-8.5'],
    license: 'CC BY 4.0',
    url: 'https://open-meteo.com/en/docs/climate-api',
    note: 'Projected values based on IPCC AR6 scenario warming estimates',
  },
};
