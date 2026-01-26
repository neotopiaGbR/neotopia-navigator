import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRegion } from '@/contexts/RegionContext';

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
  selectedYearValue: number | null;
  previousYearValue: number | null;
  delta: number | null;
  deltaPercent: number | null;
  sparklineValues: { year: number; value: number }[];
}

interface ResolvedIndicator {
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
  const { setDatasetsUsed } = useRegion();
  const [data, setData] = useState<RegionIndicatorData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  const updateDatasetsUsed = useCallback((datasets: string[]) => {
    setDatasetsUsed(datasets);
  }, [setDatasetsUsed]);

  useEffect(() => {
    if (!regionId) {
      setData([]);
      setError(null);
      setAvailableYears([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Call the resolve-indicators Edge Function
        const { data: response, error: fnError } = await supabase.functions.invoke('resolve-indicators', {
          body: {
            region_id: regionId,
            year: selectedYear ?? new Date().getFullYear(),
          },
        });

        if (import.meta.env.DEV) {
          console.log('[useRegionIndicators] Edge function response:', { regionId, response, error: fnError });
        }

        if (fnError) {
          // Fallback to RPC if Edge Function fails
          console.warn('[useRegionIndicators] Edge function failed, falling back to RPC:', fnError);
          const { data: rpcData, error: rpcError } = await supabase
            .rpc('get_region_indicators', { 
              p_region_id: regionId,
              p_year: null
            });

          if (rpcError) throw rpcError;
          
          if (cancelled) return;

          if (!rpcData || rpcData.length === 0) {
            setData([]);
            setAvailableYears([]);
            return;
          }

          // Process RPC response (legacy format)
          processRpcResponse(rpcData, selectedYear, setData, setAvailableYears);
          return;
        }

        if (cancelled) return;

        // Process Edge Function response
        const indicators = (response?.indicators || []) as ResolvedIndicator[];
        const datasetsUsed = (response?.datasets_used || []) as string[];

        // Track datasets used
        if (datasetsUsed.length > 0) {
          updateDatasetsUsed(datasetsUsed);
        }

        if (indicators.length === 0) {
          setData([]);
          setAvailableYears([]);
          return;
        }

        // Extract years and build RegionIndicatorData
        const yearsSet = new Set<number>();
        indicators.forEach((ind) => {
          if (ind.year) yearsSet.add(ind.year);
        });
        const years = Array.from(yearsSet).sort((a, b) => b - a);
        
        if (!cancelled) {
          setAvailableYears(years.length > 0 ? years : [new Date().getFullYear()]);
        }

        // Group by indicator code
        const indicatorMap = new Map<string, {
          indicator: Indicator;
          values: { year: number; value: number }[];
        }>();

        for (const ind of indicators) {
          const code = ind.indicator_code;
          
          if (!indicatorMap.has(code)) {
            indicatorMap.set(code, {
              indicator: {
                id: code,
                code: ind.indicator_code,
                name: ind.indicator_name,
                unit: ind.unit,
              },
              values: [],
            });
          }

          const entry = indicatorMap.get(code)!;
          if (ind.value !== null && ind.year !== null) {
            entry.values.push({
              year: ind.year,
              value: ind.value,
            });
          }
        }

        // Convert to RegionIndicatorData with computed fields
        const effectiveYear = selectedYear ?? years[0] ?? new Date().getFullYear();
        
        const processedData: RegionIndicatorData[] = Array.from(indicatorMap.values()).map((entry) => {
          const { indicator, values } = entry;
          
          const sortedValues = [...values].sort((a, b) => a.year - b.year);
          const latestYear = sortedValues.length > 0 ? sortedValues[sortedValues.length - 1].year : null;
          const latestValue = sortedValues.length > 0 ? sortedValues[sortedValues.length - 1].value : null;
          
          const selectedYearData = sortedValues.find((v) => v.year === effectiveYear);
          const selectedYearValue = selectedYearData?.value ?? latestValue;
          
          const previousYear = effectiveYear ? effectiveYear - 1 : null;
          const previousYearData = previousYear ? sortedValues.find((v) => v.year === previousYear) : null;
          const previousYearValue = previousYearData?.value ?? null;
          
          let delta: number | null = null;
          let deltaPercent: number | null = null;
          
          if (selectedYearValue !== null && previousYearValue !== null) {
            delta = selectedYearValue - previousYearValue;
            if (previousYearValue !== 0) {
              deltaPercent = (delta / Math.abs(previousYearValue)) * 100;
            }
          }
          
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

        if (!cancelled) {
          setData(processedData);
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('[useRegionIndicators] Error:', err);
        }
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load indicators');
          setData([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [regionId, selectedYear, updateDatasetsUsed]);

  return { data, isLoading, error, availableYears };
}

// Helper to process legacy RPC response
interface RpcIndicatorRow {
  indicator_code: string;
  indicator_name: string;
  unit: string;
  value: number;
  year: number;
}

function processRpcResponse(
  rpcData: RpcIndicatorRow[],
  selectedYear: number | null,
  setData: (data: RegionIndicatorData[]) => void,
  setAvailableYears: (years: number[]) => void
) {
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
          id: code,
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

  // Convert to RegionIndicatorData
  const effectiveYear = selectedYear ?? years[0] ?? null;
  
  const processedData: RegionIndicatorData[] = Array.from(indicatorMap.values()).map((entry) => {
    const { indicator, values } = entry;
    
    const sortedValues = [...values].sort((a, b) => a.year - b.year);
    const latestYear = sortedValues.length > 0 ? sortedValues[sortedValues.length - 1].year : null;
    const latestValue = sortedValues.length > 0 ? sortedValues[sortedValues.length - 1].value : null;
    
    const selectedYearData = sortedValues.find((v) => v.year === effectiveYear);
    const selectedYearValue = selectedYearData?.value ?? null;
    
    const previousYear = effectiveYear ? effectiveYear - 1 : null;
    const previousYearData = previousYear ? sortedValues.find((v) => v.year === previousYear) : null;
    const previousYearValue = previousYearData?.value ?? null;
    
    let delta: number | null = null;
    let deltaPercent: number | null = null;
    
    if (selectedYearValue !== null && previousYearValue !== null) {
      delta = selectedYearValue - previousYearValue;
      if (previousYearValue !== 0) {
        deltaPercent = (delta / Math.abs(previousYearValue)) * 100;
      }
    }
    
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
}
