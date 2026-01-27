/**
 * useClimateIndicators Hook
 * 
 * PRODUCTION VERSION - Full projection support
 * 
 * This hook:
 * 1. Fetches climate indicators from get-climate-indicators edge function
 * 2. Supports both baseline (ERA5) and projection (CMIP6) modes
 * 3. Handles all response formats (indicators array, values array, legacy)
 * 4. Never leaves loading state hanging (guaranteed finally block)
 * 5. Shows clear error messages on failure
 */

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

// Response row from edge function
interface ApiIndicatorRow {
  indicator_code: string;
  indicator_name?: string;
  value: number | null;
  unit?: string;
  scenario: string | null;
  period_start: number;
  period_end: number;
  is_baseline: boolean;
  dataset_key?: string;
}

// Possible response shapes from edge function
interface StructuredResponse {
  indicators?: ApiIndicatorRow[];
  values?: ApiIndicatorRow[];
  datasets_used?: string[];
  cached?: boolean;
  computed_at?: string;
  error?: string;
  stage?: string;
  debug?: {
    baselineMean?: number;
    projectedMean?: number;
    delta?: number;
  };
  attribution?: {
    provider?: string;
    dataset?: string;
    license?: string;
    url?: string;
    note?: string;
  };
}

function parseApiResponse(apiData: unknown): { rows: ApiIndicatorRow[]; datasets: string[] } {
  // Handle null/undefined
  if (!apiData) {
    console.warn('[useClimateIndicators] Empty API response');
    return { rows: [], datasets: [] };
  }

  // Handle array (legacy format)
  if (Array.isArray(apiData)) {
    return { rows: apiData as ApiIndicatorRow[], datasets: ['copernicus_era5_land'] };
  }

  // Handle structured response
  const response = apiData as StructuredResponse;

  // Check for error in response
  if (response.error) {
    throw new Error(response.error);
  }

  // Log debug info if present
  if (response.debug) {
    console.log('[useClimateIndicators] Projection debug:', response.debug);
  }

  // Try indicators array first (new format)
  if (Array.isArray(response.indicators)) {
    return {
      rows: response.indicators,
      datasets: response.datasets_used || ['copernicus_era5_land'],
    };
  }

  // Try values array (alternate format)
  if (Array.isArray(response.values)) {
    return {
      rows: response.values,
      datasets: response.datasets_used || ['copernicus_era5_land'],
    };
  }

  // No data found
  console.warn('[useClimateIndicators] No indicator data in response:', response);
  return { rows: [], datasets: [] };
}

function formatErrorMessage(err: unknown): string {
  if (!err) return 'Unbekannter Fehler';

  // Handle Supabase function errors
  const funcErr = err as { name?: string; message?: string; status?: number };

  // Network/deployment errors
  if (
    funcErr.name === 'FunctionsFetchError' ||
    funcErr.name === 'FunctionsHttpError' ||
    (funcErr.message && funcErr.message.includes('Load failed'))
  ) {
    return 'Klimadaten-Service nicht erreichbar. Bitte später erneut versuchen.';
  }

  // HTTP error status
  if (funcErr.status === 404) {
    return 'Edge Function nicht gefunden. Bitte Deployment prüfen.';
  }

  if (funcErr.status === 401) {
    return 'Nicht autorisiert. Bitte erneut anmelden.';
  }

  if (funcErr.status === 500) {
    return funcErr.message || 'Server-Fehler beim Laden der Klimadaten.';
  }

  // Generic error message
  if (funcErr.message) {
    return funcErr.message;
  }

  return 'Klimadaten konnten nicht geladen werden.';
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
    // No region selected - reset state
    if (!regionId) {
      setRawData([]);
      setError(null);
      setLocalDatasetsUsed([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      // CRITICAL: Always set loading true at start
      setIsLoading(true);
      setError(null);

      // Hard timeout to guarantee loading state resolves
      timeoutId = setTimeout(() => {
        if (!cancelled) {
          setError('Zeitüberschreitung beim Laden der Klimadaten.');
          setIsLoading(false);
        }
      }, 20000);

      try {
        const lastFullYear = new Date().getFullYear() - 1;
        
        // Determine if this is a projection request
        const isProjection = scenario !== 'historical' && timeHorizon !== 'baseline';
        
        console.log(`[useClimateIndicators] Fetching: scenario=${scenario}, timeHorizon=${timeHorizon}, isProjection=${isProjection}`);

        // Call edge function with appropriate parameters
        const { data: apiData, error: apiError } = await supabase.functions.invoke(
          'get-climate-indicators',
          {
            body: {
              region_id: regionId,
              p_region_id: regionId,
              year: lastFullYear,
              // Projection parameters
              p_scenario: isProjection ? scenario : null,
              scenario: isProjection ? scenario : null,
              p_period_start: isProjection ? timeHorizonConfig?.periodStart : null,
              p_period_end: isProjection ? timeHorizonConfig?.periodEnd : null,
              period_start: isProjection ? timeHorizonConfig?.periodStart : null,
              period_end: isProjection ? timeHorizonConfig?.periodEnd : null,
            },
          }
        );

        if (cancelled) return;

        // Log response
        console.log('[useClimateIndicators] Response:', { 
          apiData, 
          apiError,
          isProjection,
          scenario,
          timeHorizon 
        });

        // Handle API error
        if (apiError) {
          throw apiError;
        }

        // Parse response
        const { rows, datasets } = parseApiResponse(apiData);

        // Convert to internal format
        const values: ClimateIndicatorValue[] = rows
          .filter((row) => row.value !== null)
          .map((row) => ({
            indicator_code: row.indicator_code,
            value: Number(row.value),
            scenario: (row.scenario as ClimateScenario) ?? 'historical',
            period_start: row.period_start,
            period_end: row.period_end,
            is_baseline: row.is_baseline,
          }));

        setRawData(values);
        setLocalDatasetsUsed(datasets);
        setDatasetsUsed(datasets);
        setError(null);
      } catch (err) {
        if (cancelled) return;

        if (import.meta.env.DEV) {
          console.error('[useClimateIndicators] Error:', err);
        }

        setError(formatErrorMessage(err));
        setRawData([]);
        setLocalDatasetsUsed([]);
      } finally {
        // CRITICAL: Always clear loading state
        if (timeoutId) clearTimeout(timeoutId);
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [regionId, scenario, timeHorizon, timeHorizonConfig, fetchKey, setDatasetsUsed]);

  // Process data based on selected scenario and time horizon
  const data = useMemo((): ClimateIndicatorData[] => {
    if (rawData.length === 0) return [];
    if (!timeHorizonConfig) return [];

    const isProjection = scenario !== 'historical' && timeHorizon !== 'baseline';

    // Map raw data to UI format
    const result: ClimateIndicatorData[] = [];

    // Find baseline value from raw data
    const baselineRow = rawData.find(
      (v) => v.indicator_code === 'temp_mean_annual' && (v.is_baseline || v.scenario === 'historical')
    );
    const baselineValue = baselineRow?.value ?? null;

    // Find projection values from raw data
    const projectionRow = rawData.find(
      (v) => v.indicator_code === 'temp_mean_projection' && v.scenario === scenario
    );
    const deltaRow = rawData.find(
      (v) => v.indicator_code === 'temp_delta_vs_baseline' && v.scenario === scenario
    );

    // Get the temperature indicator definition
    const tempIndicator = CLIMATE_INDICATORS.find((ind) => ind.code === 'temp_mean_annual');

    if (tempIndicator) {
      let projectedValue: number | null = null;
      let absoluteChange: number | null = null;
      let relativeChange: number | null = null;

      if (isProjection) {
        // Use projection data
        projectedValue = projectionRow?.value ?? null;
        absoluteChange = deltaRow?.value ?? null;
        
        // Calculate relative change if we have both values
        if (absoluteChange !== null && baselineValue !== null && baselineValue !== 0) {
          relativeChange = (absoluteChange / Math.abs(baselineValue)) * 100;
        }
      } else {
        // Baseline mode - projected = baseline
        projectedValue = baselineValue;
      }

      // Only add if we have data
      if (baselineValue !== null || projectedValue !== null) {
        result.push({
          indicator: tempIndicator,
          baselineValue,
          projectedValue,
          absoluteChange,
          relativeChange,
          scenario,
          timeHorizon,
        });
      }
    }

    // Also process other indicators from CLIMATE_INDICATORS if they have data
    for (const indicator of CLIMATE_INDICATORS) {
      if (indicator.code === 'temp_mean_annual') continue; // Already handled
      if (indicator.category === 'analog') continue; // Skip analog indicators

      const indicatorBaselineRow = rawData.find(
        (v) => v.indicator_code === indicator.code && (v.is_baseline || v.scenario === 'historical')
      );
      const indicatorBaselineValue = indicatorBaselineRow?.value ?? null;

      const indicatorProjectedRow = rawData.find(
        (v) => v.indicator_code === indicator.code && v.scenario === scenario && !v.is_baseline
      );

      let projectedValue: number | null = null;
      let absoluteChange: number | null = null;
      let relativeChange: number | null = null;

      if (isProjection && indicatorProjectedRow) {
        projectedValue = indicatorProjectedRow.value;
        if (indicatorBaselineValue !== null && projectedValue !== null) {
          absoluteChange = projectedValue - indicatorBaselineValue;
          if (indicatorBaselineValue !== 0) {
            relativeChange = (absoluteChange / Math.abs(indicatorBaselineValue)) * 100;
          }
        }
      } else {
        projectedValue = indicatorBaselineValue;
      }

      if (indicatorBaselineValue !== null || projectedValue !== null) {
        result.push({
          indicator,
          baselineValue: indicatorBaselineValue,
          projectedValue,
          absoluteChange,
          relativeChange,
          scenario,
          timeHorizon,
        });
      }
    }

    return result;
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
        v.indicator_code === 'temp_mean_annual' &&
        v.scenario === scenario &&
        v.period_start === timeHorizonConfig.periodStart
    )?.value;

    const baselineMeanTemp = rawData.find(
      (v) =>
        v.indicator_code === 'temp_mean_annual' &&
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

  return {
    data,
    climateAnalog,
    isLoading,
    error,
    hasData,
    refetch,
    datasetsUsed: localDatasetsUsed,
  };
}
