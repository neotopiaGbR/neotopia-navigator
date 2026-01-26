// Dataset registry types for multi-domain data integration

export interface DatasetVersion {
  id: string;
  dataset_key: string;
  source: string;
  license: string;
  license_url: string | null;
  attribution: string;
  url: string;
  coverage: string;
  resolution: string | null;
  update_cycle: string;
  default_ttl_days: number;
  version: string | null;
  fetched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndicatorValue {
  id: string;
  region_id: string;
  indicator_id: string;
  value: number | null;
  value_text: string | null;
  year: number | null;
  period_start: number | null;
  period_end: number | null;
  scenario: string | null;
  stat: string | null;
  source_product_key: string | null;
  computed_at: string;
  expires_at: string;
  stale: boolean;
  meta: Record<string, unknown> | null;
}

export interface ComputedIndicator {
  indicator_code: string;
  indicator_name: string;
  value: number | null;
  value_text: string | null;
  unit: string;
  year: number | null;
  source: string;
  method: string | null;
  meta: Record<string, unknown> | null;
}

// Domain-specific types
export interface DemographyData {
  total_population: number | null;
  population_density: number | null;
  median_age: number | null;
  share_over_65: number | null;
}

export interface LandUseData {
  impervious_surface_share: number | null;
  green_share: number | null;
  urban_share: number | null;
  forest_share: number | null;
  agricultural_share: number | null;
}

export interface AirQualityData {
  no2_annual_mean: number | null;
  pm25_annual_mean: number | null;
  pm10_annual_mean: number | null;
  station_id: string | null;
  station_distance_m: number | null;
}

export interface OSMInfraData {
  tree_points_500m: number | null;
  green_area_500m: number | null;
  public_transport_stops_500m: number | null;
  amenities_1km: number | null;
  schools_1km: number | null;
  healthcare_1km: number | null;
}

// Request/response types for Edge Functions
export interface ResolveIndicatorsRequest {
  region_id: string;
  indicator_codes: string[];
  year?: number;
  period_start?: number;
  period_end?: number;
  scenario?: string;
}

export interface ResolveIndicatorsResponse {
  indicators: ComputedIndicator[];
  datasets_used: string[];
  cached: boolean;
  computed_at: string;
}

// Dataset catalog entries
export const DATASET_CATALOG: Record<string, Omit<DatasetVersion, 'id' | 'created_at' | 'updated_at' | 'fetched_at'>> = {
  // Demography
  'eurostat_geostat_pop': {
    dataset_key: 'eurostat_geostat_pop',
    source: 'Eurostat',
    license: 'CC-BY-4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: '© Eurostat, GEOSTAT grid population',
    url: 'https://ec.europa.eu/eurostat/web/gisco/geodata/reference-data/population-distribution-demography',
    coverage: 'EU',
    resolution: '1km',
    update_cycle: 'annual',
    default_ttl_days: 365,
    version: '2021',
  },
  // Land Use
  'copernicus_clc': {
    dataset_key: 'copernicus_clc',
    source: 'Copernicus Land Monitoring Service',
    license: 'ODC-BY',
    license_url: 'https://opendatacommons.org/licenses/by/1-0/',
    attribution: '© Copernicus Land Monitoring Service, CORINE Land Cover',
    url: 'https://land.copernicus.eu/pan-european/corine-land-cover',
    coverage: 'EU',
    resolution: '100m',
    update_cycle: '6-yearly',
    default_ttl_days: 365,
    version: '2018',
  },
  'copernicus_imperviousness': {
    dataset_key: 'copernicus_imperviousness',
    source: 'Copernicus Land Monitoring Service',
    license: 'ODC-BY',
    license_url: 'https://opendatacommons.org/licenses/by/1-0/',
    attribution: '© Copernicus Land Monitoring Service, Imperviousness Density',
    url: 'https://land.copernicus.eu/pan-european/high-resolution-layers/imperviousness',
    coverage: 'EU',
    resolution: '10m',
    update_cycle: '3-yearly',
    default_ttl_days: 365,
    version: '2018',
  },
  // Air Quality
  'eea_air_quality': {
    dataset_key: 'eea_air_quality',
    source: 'European Environment Agency',
    license: 'ODC-BY',
    license_url: 'https://opendatacommons.org/licenses/by/1-0/',
    attribution: '© European Environment Agency, Air Quality e-Reporting',
    url: 'https://www.eea.europa.eu/data-and-maps/data/aqereporting-9',
    coverage: 'EU',
    resolution: 'station',
    update_cycle: 'hourly',
    default_ttl_days: 1,
    version: null,
  },
  // OSM
  'osm_planet': {
    dataset_key: 'osm_planet',
    source: 'OpenStreetMap contributors',
    license: 'ODbL',
    license_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
    attribution: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/',
    coverage: 'Global',
    resolution: 'vector',
    update_cycle: 'continuous',
    default_ttl_days: 30,
    version: null,
  },
};

// Indicator definitions for non-climate domains
export const DOMAIN_INDICATORS = {
  demography: [
    { code: 'total_population', name: 'Einwohnerzahl', unit: 'Personen', category: 'Demografie' },
    { code: 'population_density', name: 'Bevölkerungsdichte', unit: 'Ew./km²', category: 'Demografie' },
    { code: 'median_age', name: 'Medianalter', unit: 'Jahre', category: 'Demografie' },
    { code: 'share_over_65', name: 'Anteil 65+', unit: '%', category: 'Demografie' },
  ],
  landuse: [
    { code: 'impervious_surface_share', name: 'Versiegelungsgrad', unit: '%', category: 'Landnutzung' },
    { code: 'green_share', name: 'Grünflächenanteil', unit: '%', category: 'Landnutzung' },
    { code: 'urban_share', name: 'Städtischer Anteil', unit: '%', category: 'Landnutzung' },
    { code: 'forest_share', name: 'Waldanteil', unit: '%', category: 'Landnutzung' },
    { code: 'agricultural_share', name: 'Landwirtschaftsanteil', unit: '%', category: 'Landnutzung' },
  ],
  airquality: [
    { code: 'no2_annual_mean', name: 'NO₂ Jahresmittel', unit: 'µg/m³', category: 'Luftqualität' },
    { code: 'pm25_annual_mean', name: 'PM2.5 Jahresmittel', unit: 'µg/m³', category: 'Luftqualität' },
    { code: 'pm10_annual_mean', name: 'PM10 Jahresmittel', unit: 'µg/m³', category: 'Luftqualität' },
  ],
  osm: [
    { code: 'tree_points_500m', name: 'Bäume (500m)', unit: 'Anzahl', category: 'Grüninfrastruktur' },
    { code: 'green_area_500m', name: 'Grünfläche (500m)', unit: 'm²', category: 'Grüninfrastruktur' },
    { code: 'public_transport_stops_500m', name: 'ÖPNV-Haltestellen (500m)', unit: 'Anzahl', category: 'Infrastruktur' },
    { code: 'amenities_1km', name: 'Einrichtungen (1km)', unit: 'Anzahl', category: 'Infrastruktur' },
    { code: 'schools_1km', name: 'Schulen (1km)', unit: 'Anzahl', category: 'Infrastruktur' },
    { code: 'healthcare_1km', name: 'Gesundheit (1km)', unit: 'Anzahl', category: 'Infrastruktur' },
  ],
};
