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

        if (fallbackError) throw fallbackError;
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

  const usedDatasets = allDatasets?.filter(ds => 
    datasetsUsed.includes(ds.dataset_key)
  ) || [];

  return {
    data: usedDatasets,
    allDatasets,
    isLoading,
    error,
  };
}
