// Complete indicator type definitions for Neotopia Navigator

export interface Indicator {
  code: string;
  name: string;
  description: string | null;
  unit: string;
  domain: string;
  topic: string | null;
  category: string;
  direction: 'higher_is_better' | 'higher_is_worse' | 'neutral';
  format: 'number' | 'percent' | 'index' | 'category' | 'text';
  precision: number;
}

export interface Dataset {
  dataset_key: string;
  name: string;
  provider: string;
  coverage: string;
  license: string;
  attribution: string;
  access_type: 'api' | 'wms' | 'wfs' | 'download' | 'derived';
  base_url: string | null;
}

export interface IndicatorDatasetMapping {
  indicator_code: string;
  dataset_key: string;
  connector_key: string;
  priority: number;
  params: Record<string, unknown>;
  dataset: {
    name: string;
    provider: string;
    attribution: string;
    license: string;
  };
}

export interface IndicatorValue {
  indicator_code: string;
  indicator_name: string;
  value: number | null;
  value_text: string | null;
  unit: string;
  domain: string;
  format: 'number' | 'percent' | 'index' | 'category' | 'text';
  precision: number;
  direction: 'higher_is_better' | 'higher_is_worse' | 'neutral';
  year: number | null;
  scenario: string | null;
  source_dataset_key: string | null;
  source_attribution: string | null;
  cached: boolean;
  data_available: boolean;
  meta: Record<string, unknown> | null;
}

export interface ResolveIndicatorsRequest {
  region_id?: string;
  lat?: number;
  lon?: number;
  grid_code?: string;
  indicator_codes?: string[];
  year?: number;
  scenario?: string;
  period_start?: number;
  period_end?: number;
  force_refresh?: boolean;
}

export interface ResolveIndicatorsResponse {
  region_id: string;
  values: IndicatorValue[];
  datasets_used: string[];
  attributions: Array<{
    dataset_key: string;
    provider: string;
    attribution: string;
    license: string;
  }>;
  cached_count: number;
  computed_count: number;
  computed_at: string;
}

// Domain grouping for UI
export const DOMAIN_ORDER = [
  'Klima',
  'Wasser',
  'Landnutzung',
  'Demografie',
  'Umwelt',
  'Mobilität',
  'Infrastruktur',
  'Risiko',
  'Kontext',
] as const;

export const DOMAIN_LABELS: Record<string, string> = {
  'Klima': 'Klima & Extremwetter',
  'Wasser': 'Wasser & Schwammstadt',
  'Landnutzung': 'Landnutzung & Grün',
  'Demografie': 'Bevölkerung & Soziales',
  'Umwelt': 'Luftqualität & Umwelt',
  'Mobilität': 'Mobilität & Erreichbarkeit',
  'Infrastruktur': 'Infrastruktur & Versorgung',
  'Risiko': 'Klimarisiken',
  'Kontext': 'Kontext & Verwaltung',
};

export const DOMAIN_ICONS: Record<string, string> = {
  'Klima': 'Thermometer',
  'Wasser': 'Droplets',
  'Landnutzung': 'Trees',
  'Demografie': 'Users',
  'Umwelt': 'Wind',
  'Mobilität': 'Train',
  'Infrastruktur': 'Building2',
  'Risiko': 'AlertTriangle',
  'Kontext': 'MapPin',
};

// Scenario labels
export const SCENARIO_LABELS: Record<string, string> = {
  'historical': 'Historisch (1991-2020)',
  'ssp126': 'SSP1-2.6 (Nachhaltig)',
  'ssp245': 'SSP2-4.5 (Moderat)',
  'ssp370': 'SSP3-7.0 (Regional)',
  'ssp585': 'SSP5-8.5 (Fossil)',
};

// Format helpers
export function formatIndicatorValue(
  value: number | null,
  format: string,
  precision: number,
  unit: string
): string {
  if (value === null) return '–';
  
  let formatted: string;
  
  switch (format) {
    case 'percent':
      formatted = value.toFixed(precision) + '%';
      break;
    case 'index':
      formatted = value.toFixed(precision);
      break;
    case 'number':
    default:
      formatted = value.toLocaleString('de-DE', {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      });
      if (unit) formatted += ' ' + unit;
  }
  
  return formatted;
}

export function getDirectionIcon(direction: string, delta: number | null): 'up' | 'down' | 'neutral' {
  if (delta === null || Math.abs(delta) < 0.01) return 'neutral';
  
  const isPositive = delta > 0;
  
  if (direction === 'higher_is_better') {
    return isPositive ? 'up' : 'down';
  } else if (direction === 'higher_is_worse') {
    return isPositive ? 'down' : 'up';
  }
  
  return 'neutral';
}

export function getDirectionColor(direction: string, delta: number | null): string {
  if (delta === null || Math.abs(delta) < 0.01) return 'text-muted-foreground';
  
  const isPositive = delta > 0;
  
  if (direction === 'higher_is_better') {
    return isPositive ? 'text-green-500' : 'text-red-500';
  } else if (direction === 'higher_is_worse') {
    return isPositive ? 'text-red-500' : 'text-green-500';
  }
  
  return 'text-muted-foreground';
}
