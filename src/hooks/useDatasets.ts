import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Dataset {
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

// Fallback dataset definitions for when DB doesn't have entries yet
const FALLBACK_DATASETS: Record<string, Omit<Dataset, 'id' | 'created_at' | 'updated_at' | 'fetched_at' | 'version'>> = {
  copernicus_era5_land: {
    dataset_key: 'copernicus_era5_land',
    source: 'Copernicus Climate Change Service (C3S)',
    license: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Copernicus Climate Change Service (C3S): ERA5-Land hourly data from 1950 to present',
    url: 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/reanalysis-era5-land',
    coverage: 'Global, 0.1° (~9km)',
    resolution: '0.1°',
    update_cycle: 'Monatlich',
    default_ttl_days: 90,
  },
  copernicus_eurocordex: {
    dataset_key: 'copernicus_eurocordex',
    source: 'Copernicus Climate Change Service (C3S)',
    license: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Copernicus Climate Change Service (C3S): EURO-CORDEX EUR-11 regional climate projections (bias-adjusted)',
    url: 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/projections-cordex-domains-single-levels',
    coverage: 'Europa, 0.11° (~12km)',
    resolution: '0.11°',
    update_cycle: 'Statisch (CMIP6)',
    default_ttl_days: 365,
  },
  eurostat_geostat: {
    dataset_key: 'eurostat_geostat',
    source: 'Eurostat GEOSTAT',
    license: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Eurostat GEOSTAT: Population grid 1km',
    url: 'https://ec.europa.eu/eurostat/web/gisco/geodata/reference-data/population-distribution-demography/geostat',
    coverage: 'EU27, 1km Raster',
    resolution: '1km',
    update_cycle: 'Jährlich',
    default_ttl_days: 180,
  },
  copernicus_corine: {
    dataset_key: 'copernicus_corine',
    source: 'Copernicus Land Monitoring Service',
    license: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Copernicus Land Monitoring Service: CORINE Land Cover',
    url: 'https://land.copernicus.eu/pan-european/corine-land-cover',
    coverage: 'Europa, 100m',
    resolution: '100m',
    update_cycle: '6 Jahre',
    default_ttl_days: 365,
  },
  copernicus_imperviousness: {
    dataset_key: 'copernicus_imperviousness',
    source: 'Copernicus Land Monitoring Service',
    license: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Copernicus Land Monitoring Service: High Resolution Layer Imperviousness Density',
    url: 'https://land.copernicus.eu/pan-european/high-resolution-layers/imperviousness',
    coverage: 'Europa, 10m',
    resolution: '10m',
    update_cycle: '3 Jahre',
    default_ttl_days: 365,
  },
  eea_airquality: {
    dataset_key: 'eea_airquality',
    source: 'European Environment Agency (EEA)',
    license: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'EEA Air Quality e-Reporting: Validated measurements from monitoring stations',
    url: 'https://www.eea.europa.eu/themes/air/air-quality-index',
    coverage: 'EU27 + EEA Länder',
    resolution: 'Stationen',
    update_cycle: 'Stündlich',
    default_ttl_days: 1,
  },
  osm: {
    dataset_key: 'osm',
    source: 'OpenStreetMap',
    license: 'ODbL',
    license_url: 'https://opendatacommons.org/licenses/odbl/',
    attribution: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/',
    coverage: 'Global',
    resolution: 'Vektordaten',
    update_cycle: 'Kontinuierlich',
    default_ttl_days: 30,
  },
};

export function useDatasets() {
  return useQuery({
    queryKey: ['datasets'],
    queryFn: async (): Promise<Dataset[]> => {
      const { data, error } = await supabase.rpc('list_datasets');

      if (error) {
        console.error('[useDatasets] RPC error:', error);
        // Fallback to direct table query if RPC doesn't exist
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('dataset_versions')
          .select('*')
          .order('source, dataset_key');

        if (fallbackError) {
          console.error('[useDatasets] Fallback query error:', fallbackError);
          // Return empty array, will use FALLBACK_DATASETS in useUsedDatasets
          return [];
        }
        return (fallbackData || []) as Dataset[];
      }

      return (data || []) as Dataset[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to get only datasets that were used in the current view
export function useUsedDatasets(datasetsUsed: string[]) {
  const { data: allDatasets, isLoading, error } = useDatasets();

  // Filter from DB datasets
  const dbDatasets = allDatasets?.filter(ds => 
    datasetsUsed.includes(ds.dataset_key)
  ) || [];

  // Find missing datasets and use fallbacks
  const dbDatasetKeys = new Set(dbDatasets.map(ds => ds.dataset_key));
  const missingKeys = datasetsUsed.filter(key => !dbDatasetKeys.has(key));
  
  const fallbackDatasets: Dataset[] = missingKeys
    .filter(key => FALLBACK_DATASETS[key])
    .map(key => ({
      ...FALLBACK_DATASETS[key],
      id: `fallback-${key}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      fetched_at: null,
      version: null,
    }));

  const usedDatasets = [...dbDatasets, ...fallbackDatasets];

  return {
    data: usedDatasets,
    allDatasets,
    isLoading,
    error,
  };
}
