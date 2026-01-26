import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  ClimateScenario,
  ClimateTimeHorizon,
  ClimateIndicatorData,
  ClimateIndicatorValue,
  ClimateAnalogResult,
  CLIMATE_INDICATORS,
  CLIMATE_ANALOG_LOCATIONS,
  CLIMATE_TIME_HORIZONS,
} from '@/components/climate/types';

interface UseClimateIndicatorsResult {
  data: ClimateIndicatorData[];
  climateAnalog: ClimateAnalogResult;
  isLoading: boolean;
  error: string | null;
  hasData: boolean;
}

interface RpcClimateRow {
  indicator_code: string;
  value: number;
  scenario: string | null;
  period_start: number;
  period_end: number;
  is_baseline: boolean;
}

export function useClimateIndicators(
  regionId: string | null,
  scenario: ClimateScenario,
  timeHorizon: ClimateTimeHorizon
): UseClimateIndicatorsResult {
  const [rawData, setRawData] = useState<ClimateIndicatorValue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch climate data
  useEffect(() => {
    if (!regionId) {
      setRawData([]);
      setError(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Call RPC to get climate indicator data
        const { data: rpcData, error: rpcError } = await supabase
          .rpc('get_climate_indicators', {
            p_region_id: regionId,
          });

        if (import.meta.env.DEV) {
          console.log('[useClimateIndicators] RPC response:', { regionId, data: rpcData, error: rpcError });
        }

        if (rpcError) {
          // Check if it's a "function does not exist" error - means no data yet
          if (rpcError.message?.includes('function') || rpcError.code === '42883') {
            if (!cancelled) {
              setRawData([]);
              setError(null); // Don't show error for missing function
            }
            return;
          }
          throw rpcError;
        }

        if (cancelled) return;

        if (!rpcData || rpcData.length === 0) {
          setRawData([]);
          return;
        }

        const rows = rpcData as RpcClimateRow[];
        
        const values: ClimateIndicatorValue[] = rows.map((row) => ({
          indicator_code: row.indicator_code,
          value: Number(row.value),
          scenario: (row.scenario as ClimateScenario) ?? 'baseline',
          period_start: row.period_start,
          period_end: row.period_end,
          is_baseline: row.is_baseline,
        }));

        if (!cancelled) {
          setRawData(values);
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('[useClimateIndicators] RPC error:', err);
        }
        if (!cancelled) {
          // Don't show error to user - just show empty state
          setError(null);
          setRawData([]);
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
  }, [regionId]);

  // Process data based on selected scenario and time horizon
  const data = useMemo((): ClimateIndicatorData[] => {
    if (rawData.length === 0) return [];

    const timeHorizonConfig = CLIMATE_TIME_HORIZONS.find((h) => h.value === timeHorizon);
    if (!timeHorizonConfig) return [];

    return CLIMATE_INDICATORS.map((indicator) => {
      // Find baseline value
      const baselineRow = rawData.find(
        (v) =>
          v.indicator_code === indicator.code &&
          v.is_baseline
      );
      const baselineValue = baselineRow?.value ?? null;

      // For baseline scenario, projected = baseline
      let projectedValue: number | null = null;
      if (scenario === 'baseline' || timeHorizon === 'baseline') {
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

      if (baselineValue !== null && projectedValue !== null && scenario !== 'baseline' && timeHorizon !== 'baseline') {
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
  }, [rawData, scenario, timeHorizon]);

  // Calculate climate analog
  const climateAnalog = useMemo((): ClimateAnalogResult => {
    if (rawData.length === 0 || scenario === 'baseline' || timeHorizon === 'baseline') {
      return {
        analogLocation: null,
        similarityScore: null,
        description: 'Wählen Sie ein Zukunftsszenario, um Klimaanalogien anzuzeigen.',
      };
    }

    const timeHorizonConfig = CLIMATE_TIME_HORIZONS.find((h) => h.value === timeHorizon);
    if (!timeHorizonConfig) {
      return {
        analogLocation: null,
        similarityScore: null,
        description: 'Zeitraum nicht gefunden.',
      };
    }

    // Get projected values for fingerprint indicators
    const fingerprintIndicators = ['mean_annual_temperature', 'tx95p', 'tropical_nights_20c', 'summer_precipitation_change'];
    
    const projectedFingerprint: Record<string, number> = {};
    for (const code of fingerprintIndicators) {
      const row = rawData.find(
        (v) =>
          v.indicator_code === code &&
          v.scenario === scenario &&
          v.period_start === timeHorizonConfig.periodStart
      );
      if (row) {
        projectedFingerprint[code] = row.value;
      }
    }

    // If we don't have enough data, return early
    if (Object.keys(projectedFingerprint).length < 2) {
      return {
        analogLocation: null,
        similarityScore: null,
        description: 'Nicht genügend Daten für Klimaanalogie.',
      };
    }

    // Simple heuristic for demo: based on mean temperature projection
    const projectedTemp = projectedFingerprint['mean_annual_temperature'];
    if (projectedTemp === undefined) {
      return {
        analogLocation: null,
        similarityScore: null,
        description: 'Temperaturprojektion nicht verfügbar.',
      };
    }

    // Match based on temperature (simplified algorithm)
    // In reality, this would use a proper nearest-neighbor algorithm with European baseline data
    let matchedLocation = CLIMATE_ANALOG_LOCATIONS[0];
    let minDiff = Infinity;

    // Approximate current temperatures for analog locations
    const locationTemps: Record<string, number> = {
      'Rom': 15.5,
      'Marseille': 14.5,
      'Barcelona': 15.8,
      'Madrid': 14.5,
      'Mailand': 13.5,
      'Lyon': 12.5,
      'Bordeaux': 13.0,
      'Toulouse': 13.5,
      'Zagreb': 11.5,
      'Budapest': 11.0,
      'Wien': 10.5,
      'Prag': 9.5,
    };

    for (const location of CLIMATE_ANALOG_LOCATIONS) {
      const locTemp = locationTemps[location.name] ?? 12;
      const diff = Math.abs(projectedTemp - locTemp);
      if (diff < minDiff) {
        minDiff = diff;
        matchedLocation = location;
      }
    }

    // Calculate similarity score (0-100)
    const similarityScore = Math.max(0, 100 - minDiff * 10);

    const scenarioLabel = scenario === 'ssp126' ? 'SSP1-2.6' : scenario === 'ssp245' ? 'SSP2-4.5' : 'SSP5-8.5';
    
    return {
      analogLocation: matchedLocation,
      similarityScore: Math.round(similarityScore),
      description: `Im Szenario ${scenarioLabel} (${timeHorizon}) wird das Klima dieser Region dem heutigen Klima von ${matchedLocation.name} (${matchedLocation.country}) ähneln.`,
    };
  }, [rawData, scenario, timeHorizon]);

  const hasData = rawData.length > 0;

  return { data, climateAnalog, isLoading, error, hasData };
}
