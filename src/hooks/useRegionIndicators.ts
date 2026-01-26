import { useEffect, useState, useMemo } from 'react';
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
  // For selected year display
  selectedYearValue: number | null;
  previousYearValue: number | null;
  delta: number | null;
  deltaPercent: number | null;
  // Sparkline data (last 5 years from selected year)
  sparklineValues: { year: number; value: number }[];
}

interface RpcIndicatorRow {
  indicator_code: string;
  indicator_name: string;
  unit: string;
  value: number;
  year: number;
}

interface UseRegionIndicatorsResult {
  data: RegionIndicatorData[];
  isLoading: boolean;
  error: string | null;
  availableYears: number[];
}

export function useRegionIndicators(
  regionId: string | null,
  selectedYear: number | null
): UseRegionIndicatorsResult {
  const [data, setData] = useState<RegionIndicatorData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  useEffect(() => {
    if (!regionId) {
      setData([]);
      setError(null);
      setAvailableYears([]);
      return;
    }

    const fetchIndicators = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Call RPC to get all indicator data for this region
        // We need to fetch all years first to populate availableYears and sparklines
        const { data: rpcData, error: rpcError } = await supabase
          .rpc('get_region_indicators', { 
            p_region_id: regionId,
            p_year: null // Pass null to get all years
          });

        if (rpcError) {
          throw rpcError;
        }

        if (!rpcData || rpcData.length === 0) {
          setData([]);
          setAvailableYears([]);
          setIsLoading(false);
          return;
        }

        const rows = rpcData as RpcIndicatorRow[];

        // Extract all distinct years
        const yearsSet = new Set<number>();
        rows.forEach((row) => yearsSet.add(row.year));
        const years = Array.from(yearsSet).sort((a, b) => b - a);
        setAvailableYears(years);

        // Group by indicator code
        const indicatorMap = new Map<string, {
          indicator: Indicator;
          values: { year: number; value: number }[];
        }>();

        for (const row of rows) {
          const code = row.indicator_code;

          if (!indicatorMap.has(code)) {
            indicatorMap.set(code, {
              indicator: {
                id: code, // Use code as ID since RPC doesn't return UUID
                code: row.indicator_code,
                name: row.indicator_name,
                unit: row.unit,
              },
              values: [],
            });
          }

          const entry = indicatorMap.get(code)!;
          entry.values.push({
            year: row.year,
            value: Number(row.value),
          });
        }

        // Convert to RegionIndicatorData with computed fields
        const processedData: RegionIndicatorData[] = Array.from(indicatorMap.values()).map((entry) => {
          const { indicator, values } = entry;
          
          // Sort values by year
          const sortedValues = [...values].sort((a, b) => a.year - b.year);
          const latestYear = sortedValues.length > 0 ? sortedValues[sortedValues.length - 1].year : null;
          const latestValue = sortedValues.length > 0 ? sortedValues[sortedValues.length - 1].value : null;
          
          const effectiveYear = selectedYear ?? latestYear;
          
          // Find value for selected year
          const selectedYearData = sortedValues.find((v) => v.year === effectiveYear);
          const selectedYearValue = selectedYearData?.value ?? null;
          
          // Find previous year value
          const previousYear = effectiveYear ? effectiveYear - 1 : null;
          const previousYearData = previousYear ? sortedValues.find((v) => v.year === previousYear) : null;
          const previousYearValue = previousYearData?.value ?? null;
          
          // Calculate delta
          let delta: number | null = null;
          let deltaPercent: number | null = null;
          
          if (selectedYearValue !== null && previousYearValue !== null) {
            delta = selectedYearValue - previousYearValue;
            if (previousYearValue !== 0) {
              deltaPercent = (delta / Math.abs(previousYearValue)) * 100;
            }
          }
          
          // Get sparkline values (last 5 years up to and including effective year)
          let sparklineValues: { year: number; value: number }[] = [];
          if (effectiveYear !== null) {
            sparklineValues = sortedValues
              .filter((v) => v.year <= effectiveYear && v.year > effectiveYear - 5)
              .slice(-5);
          }
          
          return {
            indicator,
            values: sortedValues,
            latestValue,
            latestYear,
            selectedYearValue,
            previousYearValue,
            delta,
            deltaPercent,
            sparklineValues,
          };
        });

        setData(processedData);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('[useRegionIndicators] RPC error:', err);
        }
        setError(err instanceof Error ? err.message : 'Failed to load indicators');
        setData([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchIndicators();
  }, [regionId, selectedYear]);

  return { data, isLoading, error, availableYears };
}
