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
  const [rawData, setRawData] = useState<{
    indicator: Indicator;
    values: { year: number; value: number }[];
  }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  useEffect(() => {
    if (!regionId) {
      setRawData([]);
      setError(null);
      setAvailableYears([]);
      return;
    }

    const fetchIndicators = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch indicator values with joined indicator metadata
        const { data: fetchedData, error: fetchError } = await supabase
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

        if (!fetchedData || fetchedData.length === 0) {
          setRawData([]);
          setAvailableYears([]);
          setIsLoading(false);
          return;
        }

        // Extract all distinct years
        const yearsSet = new Set<number>();
        fetchedData.forEach((row) => yearsSet.add(row.year));
        const years = Array.from(yearsSet).sort((a, b) => b - a);
        setAvailableYears(years);

        // Group by indicator and structure the data
        const indicatorMap = new Map<string, {
          indicator: Indicator;
          values: { year: number; value: number }[];
        }>();

        for (const row of fetchedData) {
          const indicator = row.indicators as unknown as Indicator;
          if (!indicator) continue;

          const indicatorId = indicator.id;

          if (!indicatorMap.has(indicatorId)) {
            indicatorMap.set(indicatorId, {
              indicator,
              values: [],
            });
          }

          const entry = indicatorMap.get(indicatorId)!;
          entry.values.push({
            year: row.year,
            value: Number(row.value),
          });
        }

        setRawData(Array.from(indicatorMap.values()));
      } catch (err) {
        console.error('[useRegionIndicators] Error fetching data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load indicators');
      } finally {
        setIsLoading(false);
      }
    };

    fetchIndicators();
  }, [regionId]);

  // Compute derived data based on selected year
  const data = useMemo<RegionIndicatorData[]>(() => {
    return rawData.map((entry) => {
      const { indicator, values } = entry;
      
      // Determine effective year (selected or latest)
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
  }, [rawData, selectedYear]);

  return { data, isLoading, error, availableYears };
}
