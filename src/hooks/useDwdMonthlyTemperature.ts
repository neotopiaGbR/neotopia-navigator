/**
 * useDwdMonthlyTemperature Hook
 * 
 * Fetches monthly DWD HYRAS-DE temperature values (June, July, August) 
 * for a specific location/region.
 */

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMapLayers, MonthlyTemperatureValue, AirTempAggregation } from '@/components/map/MapLayersContext';

interface MonthlyDataState {
  loading: boolean;
  error: string | null;
  values: MonthlyTemperatureValue[] | null;
  year: number | null;
}

interface UseDwdMonthlyTemperatureProps {
  lat: number | null;
  lon: number | null;
  /** Optional: use the same year as the currently loaded DWD overlay dataset */
  year?: number | null;
  enabled: boolean;
}

export function useDwdMonthlyTemperature({ lat, lon, year: preferredYear, enabled }: UseDwdMonthlyTemperatureProps) {
  const { airTemperature } = useMapLayers();
  const [state, setState] = useState<MonthlyDataState>({
    loading: false,
    error: null,
    values: null,
    year: null,
  });

  const lastFetchRef = useRef<{ lat?: number; lon?: number; aggregation?: AirTempAggregation; year?: number }>({});

  useEffect(() => {
    if (!enabled || lat === null || lon === null) {
      setState({ loading: false, error: null, values: null, year: null });
      return;
    }

    const nowYear = new Date().getFullYear();
    const year = Number.isFinite(preferredYear as number) ? (preferredYear as number) : nowYear - 1;

    // Skip if already fetched for this location, aggregation and year
    if (
      lastFetchRef.current.lat === lat &&
      lastFetchRef.current.lon === lon &&
      lastFetchRef.current.aggregation === airTemperature.aggregation &&
      lastFetchRef.current.year === year &&
      state.values
    ) {
      return;
    }

    const fetchMonthlyData = async () => {
      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const variable = airTemperature.aggregation === 'daily_max' ? 'max' : 'mean';

        console.log('[useDwdMonthlyTemperature] Fetching monthly data for', { lat, lon, variable, year });

        const { data: responseData, error } = await supabase.functions.invoke('get-dwd-temperature', {
          body: { 
            variable,
            sample: 10, // Larger sample for faster response (we only need one cell)
            includeMonthly: true,
            lat,
            lon,
            year,
          },
        });

        if (error) {
          throw new Error(error.message || 'Edge Function Fehler');
        }

        if (responseData.status === 'error') {
          throw new Error(responseData.error || 'Unbekannter Fehler');
        }

        const monthlyValues = responseData.data?.monthlyValues as MonthlyTemperatureValue[] | undefined;

        lastFetchRef.current = { lat, lon, aggregation: airTemperature.aggregation, year };
        
        setState({
          loading: false,
          error: null,
          values: monthlyValues ?? null,
          year,
        });

        console.log('[useDwdMonthlyTemperature] Monthly values loaded:', monthlyValues);
      } catch (err) {
        console.error('[useDwdMonthlyTemperature] Error:', err);
        setState({
          loading: false,
          error: err instanceof Error ? err.message : 'Fehler beim Laden der Monatsdaten',
          values: null,
          year: null,
        });
      }
    };

    // Debounce to avoid rapid requests
    const timeout = setTimeout(fetchMonthlyData, 500);
    return () => clearTimeout(timeout);
  }, [enabled, lat, lon, preferredYear, airTemperature.aggregation, state.values]);

  // Reset when disabled
  useEffect(() => {
    if (!enabled) {
      lastFetchRef.current = {};
    }
  }, [enabled]);

  return state;
}
