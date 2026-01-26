import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRegion } from '@/contexts/RegionContext';
import {
  ClimateScenario,
  ClimateTimeHorizon,
  ClimateIndicatorData,
  ClimateIndicatorValue,
  ClimateAnalogResult,
  CLIMATE_INDICATORS,
  CLIMATE_ANALOG_LOCATIONS,
  CLIMATE_TIME_HORIZONS,
  ClimateAnalogLocation,
} from '@/components/climate/types';

interface UseClimateIndicatorsResult {
  data: ClimateIndicatorData[];
  climateAnalog: ClimateAnalogResult;
  isLoading: boolean;
  error: string | null;
  hasData: boolean;
  refetch: () => void;
  datasetsUsed: string[];
}

interface RpcClimateRow {
  indicator_code: string;
  indicator_name?: string;
  value: number;
  unit?: string;
  scenario: string | null;
  period_start: number;
  period_end: number;
  is_baseline: boolean;
  dataset_key?: string;
  attribution?: string;
}

interface ClimateApiResponse {
  indicators: RpcClimateRow[];
  datasets_used: string[];
  cached: boolean;
  computed_at: string;
}

export function useClimateIndicators(
  regionId: string | null,
  scenario: ClimateScenario,
  timeHorizon: ClimateTimeHorizon
): UseClimateIndicatorsResult {
  const { setDatasetsUsed } = useRegion();
  const [rawData, setRawData] = useState<ClimateIndicatorValue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [localDatasetsUsed, setLocalDatasetsUsed] = useState<string[]>([]);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  // Get time horizon config
  const timeHorizonConfig = CLIMATE_TIME_HORIZONS.find((h) => h.value === timeHorizon);

  // Fetch climate data via Edge Function
  useEffect(() => {
    if (!regionId) {
      setRawData([]);
      setError(null);
      setLocalDatasetsUsed([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Call the edge function directly
        const { data: apiData, error: apiError } = await supabase.functions.invoke(
          'get-climate-indicators',
          {
            body: {
              p_region_id: regionId,
              p_scenario: scenario === 'historical' ? null : scenario,
              p_period_start: timeHorizonConfig?.periodStart ?? 1991,
              p_period_end: timeHorizonConfig?.periodEnd ?? 2020,
            },
          }
        );

        if (import.meta.env.DEV) {
          console.log('[useClimateIndicators] API response:', {
            regionId,
            scenario,
            timeHorizon,
            data: apiData,
            error: apiError,
          });
        }

        if (apiError) {
          throw apiError;
        }

        if (cancelled) return;

        // Handle the structured response
        const response = apiData as ClimateApiResponse | RpcClimateRow[];
        
        let rows: RpcClimateRow[] = [];
        let datasets: string[] = [];

        if (Array.isArray(response)) {
          // Legacy array format
          rows = response;
          datasets = ['copernicus_era5_land'];
        } else if (response && 'indicators' in response) {
          // New structured format
          rows = response.indicators || [];
          datasets = response.datasets_used || [];
        }

        if (rows.length === 0) {
          setRawData([]);
          setLocalDatasetsUsed([]);
          return;
        }

        const values: ClimateIndicatorValue[] = rows.map((row) => ({
          indicator_code: row.indicator_code,
          value: Number(row.value),
          scenario: (row.scenario as ClimateScenario) ?? 'historical',
          period_start: row.period_start,
          period_end: row.period_end,
          is_baseline: row.is_baseline,
        }));

        if (!cancelled) {
          setRawData(values);
          setLocalDatasetsUsed(datasets);
          // Update global context for attribution panel
          setDatasetsUsed(datasets);
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('[useClimateIndicators] Error:', err);
        }
        if (!cancelled) {
          setError('Klimadaten konnten nicht geladen werden. Bitte versuchen Sie es später erneut.');
          setRawData([]);
          setLocalDatasetsUsed([]);
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
  }, [regionId, scenario, timeHorizon, timeHorizonConfig, fetchKey, setDatasetsUsed]);

  // Process data based on selected scenario and time horizon
  const data = useMemo((): ClimateIndicatorData[] => {
    if (rawData.length === 0) return [];

    if (!timeHorizonConfig) return [];

    return CLIMATE_INDICATORS.filter((ind) => ind.category !== 'analog').map((indicator) => {
      // Find baseline value (historical, 1991-2020)
      const baselineRow = rawData.find(
        (v) =>
          v.indicator_code === indicator.code &&
          (v.is_baseline || v.scenario === 'historical')
      );
      const baselineValue = baselineRow?.value ?? null;

      // For baseline scenario/horizon, projected = baseline
      let projectedValue: number | null = null;
      if (scenario === 'historical' || timeHorizon === 'baseline') {
        projectedValue = baselineValue;
      } else {
        // Find projected value for selected scenario and time horizon
        const projectedRow = rawData.find(
          (v) =>
            v.indicator_code === indicator.code &&
            v.scenario === scenario &&
            v.period_start === timeHorizonConfig.periodStart &&
            v.period_end === timeHorizonConfig.periodEnd
        );
        projectedValue = projectedRow?.value ?? null;
      }

      // Calculate changes
      let absoluteChange: number | null = null;
      let relativeChange: number | null = null;

      if (
        baselineValue !== null &&
        projectedValue !== null &&
        scenario !== 'historical' &&
        timeHorizon !== 'baseline'
      ) {
        absoluteChange = projectedValue - baselineValue;
        if (baselineValue !== 0) {
          relativeChange = (absoluteChange / Math.abs(baselineValue)) * 100;
        }
      }

      return {
        indicator,
        baselineValue,
        projectedValue,
        absoluteChange,
        relativeChange,
        scenario,
        timeHorizon,
      };
    });
  }, [rawData, scenario, timeHorizon, timeHorizonConfig]);

  // Calculate climate analog based on projected summer temperature
  const climateAnalog = useMemo((): ClimateAnalogResult => {
    if (rawData.length === 0 || scenario === 'historical' || timeHorizon === 'baseline') {
      return {
        analogLocation: null,
        latitudeShiftKm: null,
        similarityScore: null,
        description: 'Wählen Sie ein Zukunftsszenario, um Klimaanalogien anzuzeigen.',
      };
    }

    if (!timeHorizonConfig) {
      return {
        analogLocation: null,
        latitudeShiftKm: null,
        similarityScore: null,
        description: 'Zeitraum nicht gefunden.',
      };
    }

    // Get projected summer mean temperature
    const projectedSummerTemp = rawData.find(
      (v) =>
        v.indicator_code === 'summer_mean_temperature' &&
        v.scenario === scenario &&
        v.period_start === timeHorizonConfig.periodStart
    )?.value;

    const baselineSummerTemp = rawData.find(
      (v) =>
        v.indicator_code === 'summer_mean_temperature' &&
        (v.is_baseline || v.scenario === 'historical')
    )?.value;

    // Fallback to mean annual temperature
    const projectedMeanTemp = rawData.find(
      (v) =>
        v.indicator_code === 'mean_annual_temperature' &&
        v.scenario === scenario &&
        v.period_start === timeHorizonConfig.periodStart
    )?.value;

    const baselineMeanTemp = rawData.find(
      (v) =>
        v.indicator_code === 'mean_annual_temperature' &&
        (v.is_baseline || v.scenario === 'historical')
    )?.value;

    const targetTemp = projectedSummerTemp ?? projectedMeanTemp;
    const currentTemp = baselineSummerTemp ?? baselineMeanTemp;

    if (targetTemp === undefined) {
      return {
        analogLocation: null,
        latitudeShiftKm: null,
        similarityScore: null,
        description: 'Temperaturprojektion nicht verfügbar.',
      };
    }

    // Find closest analog city by summer temperature
    let bestMatch: ClimateAnalogLocation = CLIMATE_ANALOG_LOCATIONS[0];
    let minDiff = Infinity;

    for (const location of CLIMATE_ANALOG_LOCATIONS) {
      const locTemp = projectedSummerTemp ? location.summerMeanTemp : location.meanAnnualTemp;
      const diff = Math.abs(targetTemp - locTemp);
      if (diff < minDiff) {
        minDiff = diff;
        bestMatch = location;
      }
    }

    // Calculate latitude shift (approx 111km per degree)
    let latitudeShiftKm: number | null = null;
    if (currentTemp !== undefined && targetTemp !== undefined) {
      // Rough approximation: 0.6°C per degree latitude in Europe
      const tempDelta = targetTemp - currentTemp;
      const latShift = tempDelta / 0.6;
      latitudeShiftKm = Math.round(latShift * 111);
    }

    // Similarity score (100 = perfect match)
    const similarityScore = Math.max(0, Math.round(100 - minDiff * 15));

    const scenarioLabel =
      scenario === 'ssp126'
        ? 'SSP1-2.6'
        : scenario === 'ssp245'
        ? 'SSP2-4.5'
        : scenario === 'ssp370'
        ? 'SSP3-7.0'
        : 'SSP5-8.5';

    const horizonLabel = timeHorizonConfig.label;

    return {
      analogLocation: bestMatch,
      latitudeShiftKm,
      similarityScore,
      description: `Im Szenario ${scenarioLabel} (${horizonLabel}) wird das Klima dieser Region dem heutigen Klima von ${bestMatch.name} (${bestMatch.country}) ähneln.${
        latitudeShiftKm !== null && latitudeShiftKm > 0
          ? ` Das entspricht einer Verschiebung um ca. ${latitudeShiftKm} km nach Süden.`
          : ''
      }`,
    };
  }, [rawData, scenario, timeHorizon, timeHorizonConfig]);

  const hasData = rawData.length > 0;

  return { data, climateAnalog, isLoading, error, hasData, refetch, datasetsUsed: localDatasetsUsed };
}
