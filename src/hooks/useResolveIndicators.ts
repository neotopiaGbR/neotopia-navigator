import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ResolvedIndicator {
  indicator_code: string;
  indicator_name: string;
  value: number | null;
  value_text: string | null;
  unit: string;
  year: number | null;
  source: string | null;
  method: string | null;
  meta: Record<string, unknown> | null;
}

export interface ResolveIndicatorsResult {
  indicators: ResolvedIndicator[];
  datasets_used: string[];
  cached: boolean;
  computed_at: string;
}

interface UseResolveIndicatorsParams {
  regionId: string | null;
  indicatorCodes?: string[];
  year?: number | null;
  scenario?: string | null;
  periodStart?: number | null;
  periodEnd?: number | null;
}

export function useResolveIndicators({
  regionId,
  indicatorCodes,
  year,
  scenario,
  periodStart,
  periodEnd,
}: UseResolveIndicatorsParams) {
  return useQuery({
    queryKey: ['resolve-indicators', regionId, indicatorCodes, year, scenario, periodStart, periodEnd],
    queryFn: async (): Promise<ResolveIndicatorsResult> => {
      if (!regionId) {
        return { indicators: [], datasets_used: [], cached: false, computed_at: '' };
      }

      const { data, error } = await supabase.functions.invoke('resolve-indicators', {
        body: {
          region_id: regionId,
          indicator_codes: indicatorCodes,
          year: year ?? new Date().getFullYear(),
          scenario: scenario || undefined,
          period_start: periodStart || undefined,
          period_end: periodEnd || undefined,
        },
      });

      if (error) {
        console.error('[useResolveIndicators] Edge function error:', error);
        throw new Error('Indikatoren konnten nicht geladen werden');
      }

      return data as ResolveIndicatorsResult;
    },
    enabled: !!regionId,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: false,
  });
}

// Hook for comparison mode - fetches indicators for two regions
export function useResolveIndicatorsComparison({
  primaryRegionId,
  comparisonRegionId,
  indicatorCodes,
  year,
  scenario,
  periodStart,
  periodEnd,
}: {
  primaryRegionId: string | null;
  comparisonRegionId: string | null;
  indicatorCodes?: string[];
  year?: number | null;
  scenario?: string | null;
  periodStart?: number | null;
  periodEnd?: number | null;
}) {
  const primaryQuery = useResolveIndicators({
    regionId: primaryRegionId,
    indicatorCodes,
    year,
    scenario,
    periodStart,
    periodEnd,
  });

  const comparisonQuery = useResolveIndicators({
    regionId: comparisonRegionId,
    indicatorCodes,
    year,
    scenario,
    periodStart,
    periodEnd,
  });

  // Merge datasets_used from both queries
  const allDatasetsUsed = new Set<string>([
    ...(primaryQuery.data?.datasets_used || []),
    ...(comparisonQuery.data?.datasets_used || []),
  ]);

  return {
    primary: primaryQuery,
    comparison: comparisonQuery,
    datasetsUsed: Array.from(allDatasetsUsed),
    isLoading: primaryQuery.isLoading || (comparisonRegionId ? comparisonQuery.isLoading : false),
    error: primaryQuery.error || comparisonQuery.error,
  };
}
