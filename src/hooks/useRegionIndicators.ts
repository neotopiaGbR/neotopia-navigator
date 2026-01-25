import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Indicator {
  id: string;
  code: string;
  name: string;
  unit: string;
}

export interface IndicatorValue {
  id: string;
  indicator_id: string;
  region_id: string;
  value: number;
  year: number;
}

export interface RegionIndicatorData {
  indicator: Indicator;
  values: { year: number; value: number }[];
  latestValue: number | null;
  latestYear: number | null;
}

interface UseRegionIndicatorsResult {
  data: RegionIndicatorData[];
  isLoading: boolean;
  error: string | null;
}

export function useRegionIndicators(regionId: string | null): UseRegionIndicatorsResult {
  const [data, setData] = useState<RegionIndicatorData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!regionId) {
      setData([]);
      setError(null);
      return;
    }

    const fetchIndicators = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch indicator values with joined indicator metadata
        const { data: rawData, error: fetchError } = await supabase
          .from('indicator_values')
          .select(`
            id,
            value,
            year,
            indicator_id,
            indicators (
              id,
              code,
              name,
              unit
            )
          `)
          .eq('region_id', regionId)
          .order('indicator_id', { ascending: true })
          .order('year', { ascending: true });

        if (fetchError) {
          throw fetchError;
        }

        if (!rawData || rawData.length === 0) {
          setData([]);
          setIsLoading(false);
          return;
        }

        // Group by indicator and structure the data
        const indicatorMap = new Map<string, RegionIndicatorData>();

        for (const row of rawData) {
          const indicator = row.indicators as unknown as Indicator;
          if (!indicator) continue;

          const indicatorId = indicator.id;

          if (!indicatorMap.has(indicatorId)) {
            indicatorMap.set(indicatorId, {
              indicator,
              values: [],
              latestValue: null,
              latestYear: null,
            });
          }

          const entry = indicatorMap.get(indicatorId)!;
          entry.values.push({
            year: row.year,
            value: Number(row.value),
          });
        }

        // Calculate latest value for each indicator
        const result: RegionIndicatorData[] = [];
        indicatorMap.forEach((entry) => {
          if (entry.values.length > 0) {
            const latest = entry.values[entry.values.length - 1];
            entry.latestValue = latest.value;
            entry.latestYear = latest.year;
          }
          result.push(entry);
        });

        setData(result);
      } catch (err) {
        console.error('[useRegionIndicators] Error fetching data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load indicators');
      } finally {
        setIsLoading(false);
      }
    };

    fetchIndicators();
  }, [regionId]);

  return { data, isLoading, error };
}
