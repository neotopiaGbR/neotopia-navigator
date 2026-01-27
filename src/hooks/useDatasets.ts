import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Dataset {
  id: string;
  key: string;
  name: string;
  provider: string;
  domain: string;
  geographic_coverage: string;
  access_type: string;
  license: string;
  attribution: string;
  url: string | null;
  notes: string | null;
  update_frequency: string | null;
  version: string | null;
  created_at: string;
}

export interface IndicatorSource {
  indicator_code: string;
  dataset_key: string;
  dataset_name: string;
  provider: string;
  license: string;
  attribution: string;
  url: string | null;
  connector_key: string;
  priority: number;
}

// Fallback dataset definitions for when DB doesn't have entries yet
const FALLBACK_DATASETS: Record<string, Omit<Dataset, 'id' | 'created_at'>> = {
  copernicus_era5_land: {
    key: 'copernicus_era5_land',
    name: 'ERA5-Land Hourly Data',
    provider: 'Copernicus Climate Change Service (C3S)',
    domain: 'climate',
    geographic_coverage: 'global',
    access_type: 'api',
    license: 'CC BY 4.0',
    attribution: 'Copernicus Climate Change Service (C3S): ERA5-Land hourly data from 1950 to present',
    url: 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/reanalysis-era5-land',
    notes: '0.1° resolution (~9km), hourly, 1950-present',
    update_frequency: 'monthly',
    version: null,
  },
  copernicus_eurocordex: {
    key: 'copernicus_eurocordex',
    name: 'EURO-CORDEX Climate Projections',
    provider: 'Copernicus Climate Change Service (C3S)',
    domain: 'climate',
    geographic_coverage: 'EU',
    access_type: 'api',
    license: 'CC BY 4.0',
    attribution: 'Copernicus Climate Change Service (C3S): CORDEX regional climate model data',
    url: 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/projections-cordex-domains-single-levels',
    notes: 'EUR-11 (0.11°/~12km), bias-adjusted, CMIP5/CMIP6 scenarios',
    update_frequency: 'static',
    version: null,
  },
  eurostat_geostat: {
    key: 'eurostat_geostat',
    name: 'GEOSTAT Population Grid 1km',
    provider: 'Eurostat / GISCO',
    domain: 'demography',
    geographic_coverage: 'EU',
    access_type: 'bulk_download',
    license: 'CC BY 4.0',
    attribution: 'Eurostat GEOSTAT: Population grid based on census data. © European Union',
    url: 'https://ec.europa.eu/eurostat/web/gisco/geodata/reference-data/population-distribution-demography/geostat',
    notes: '1km grid, census-based, 2011/2018/2021',
    update_frequency: 'census cycle',
    version: null,
  },
  copernicus_corine: {
    key: 'copernicus_corine',
    name: 'CORINE Land Cover',
    provider: 'Copernicus Land Monitoring Service',
    domain: 'landuse',
    geographic_coverage: 'EU',
    access_type: 'bulk_download',
    license: 'CC BY 4.0',
    attribution: 'Copernicus Land Monitoring Service: CORINE Land Cover. © European Union',
    url: 'https://land.copernicus.eu/pan-european/corine-land-cover',
    notes: '100m resolution, 44 classes, 1990-2018',
    update_frequency: '6 years',
    version: null,
  },
  copernicus_imperviousness: {
    key: 'copernicus_imperviousness',
    name: 'High Resolution Imperviousness',
    provider: 'Copernicus Land Monitoring Service',
    domain: 'landuse',
    geographic_coverage: 'EU',
    access_type: 'bulk_download',
    license: 'CC BY 4.0',
    attribution: 'Copernicus Land Monitoring Service: High Resolution Layer Imperviousness',
    url: 'https://land.copernicus.eu/pan-european/high-resolution-layers/imperviousness',
    notes: '10m resolution, 0-100% density, 2006-2018',
    update_frequency: '3 years',
    version: null,
  },
  eea_airquality: {
    key: 'eea_airquality',
    name: 'Air Quality e-Reporting',
    provider: 'European Environment Agency (EEA)',
    domain: 'air',
    geographic_coverage: 'EU',
    access_type: 'api',
    license: 'CC BY 4.0',
    attribution: 'European Environment Agency: Air Quality e-Reporting (AQ e-Reporting). © EEA',
    url: 'https://www.eea.europa.eu/themes/air/air-quality-index',
    notes: 'Validated station measurements, hourly/daily',
    update_frequency: 'hourly',
    version: null,
  },
  osm: {
    key: 'osm',
    name: 'OpenStreetMap',
    provider: 'OpenStreetMap Contributors',
    domain: 'infrastructure',
    geographic_coverage: 'global',
    access_type: 'api',
    license: 'ODbL',
    attribution: '© OpenStreetMap contributors. Data available under the Open Database License.',
    url: 'https://www.openstreetmap.org/',
    notes: 'POIs, networks, land use, buildings',
    update_frequency: 'continuous',
    version: null,
  },
};

export function useDatasets(domainFilter?: string) {
  return useQuery({
    queryKey: ['datasets', domainFilter],
    queryFn: async (): Promise<Dataset[]> => {
      const { data, error } = await supabase.rpc('list_datasets', {
        p_domain: domainFilter || null,
      });

      if (error) {
        console.error('[useDatasets] RPC error:', error);
        // Fallback to direct table query
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('datasets')
          .select('*')
          .order('domain, name');

        if (fallbackError) {
          console.error('[useDatasets] Fallback query error:', fallbackError);
          return [];
        }
        return (fallbackData || []) as Dataset[];
      }

      return (data || []) as Dataset[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

// Fetch attribution sources for specific indicator codes
export function useIndicatorSources(indicatorCodes: string[]) {
  return useQuery({
    queryKey: ['indicator-sources', indicatorCodes],
    queryFn: async (): Promise<IndicatorSource[]> => {
      if (!indicatorCodes.length) return [];

      const { data, error } = await supabase.rpc('get_indicator_sources', {
        p_indicator_codes: indicatorCodes,
      });

      if (error) {
        console.error('[useIndicatorSources] RPC error:', error);
        return [];
      }

      return (data || []) as IndicatorSource[];
    },
    enabled: indicatorCodes.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

// Hook to get only datasets that were used in the current view
export function useUsedDatasets(datasetsUsed: string[]) {
  const { data: allDatasets, isLoading, error } = useDatasets();

  // Filter from DB datasets
  const dbDatasets = allDatasets?.filter(ds => 
    datasetsUsed.includes(ds.key)
  ) || [];

  // Find missing datasets and use fallbacks
  const dbDatasetKeys = new Set(dbDatasets.map(ds => ds.key));
  const missingKeys = datasetsUsed.filter(key => !dbDatasetKeys.has(key));
  
  const fallbackDatasets: Dataset[] = missingKeys
    .filter(key => FALLBACK_DATASETS[key])
    .map(key => ({
      ...FALLBACK_DATASETS[key],
      id: `fallback-${key}`,
      created_at: new Date().toISOString(),
    }));

  const usedDatasets = [...dbDatasets, ...fallbackDatasets];

  return {
    data: usedDatasets,
    allDatasets,
    isLoading,
    error,
  };
}
