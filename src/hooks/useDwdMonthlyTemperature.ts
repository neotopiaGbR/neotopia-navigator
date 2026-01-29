/**
 * useDwdMonthlyTemperature Hook
 * 
 * Fetches monthly DWD HYRAS-DE temperature values (June, July, August) 
 * for a specific location/region.
 * 
 * Implements automatic fallback: if the requested year returns no data,
 * it retries with the previous year (e.g., 2025 → 2024).
 */

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMapLayers, MonthlyTemperatureValue, AirTempAggregation } from '@/components/map/MapLayersContext';

interface MonthlyDataState {
  loading: boolean;
  error: string | null;
  values: MonthlyTemperatureValue[] | null;
  year: number | null;
  /** If true, data is from a fallback year (e.g., 2024 when 2025 was requested) */
  isFallback: boolean;
}

interface UseDwdMonthlyTemperatureProps {
  lat: number | null;
  lon: number | null;
  /** Optional: use the same year as the currently loaded DWD overlay dataset */
  year?: number | null;
  enabled: boolean;
}

/** Fetch monthly values for a specific year */
async function fetchMonthlyForYear(
  lat: number,
  lon: number,
  year: number,
  variable: 'mean' | 'max',
): Promise<MonthlyTemperatureValue[] | null> {
  console.log('[useDwdMonthlyTemperature] Trying year', year, { lat, lon, variable });

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
    console.warn('[useDwdMonthlyTemperature] Error for year', year, error.message);
    return null;
  }

  if (responseData.status === 'error' || responseData.status === 'no_data') {
    console.warn('[useDwdMonthlyTemperature] No data for year', year);
    return null;
  }

  const monthlyValues = responseData.data?.monthlyValues as MonthlyTemperatureValue[] | undefined;
  
  // Empty array also counts as "no data"
  if (!monthlyValues || monthlyValues.length === 0) {
    console.warn('[useDwdMonthlyTemperature] Empty monthly values for year', year);
    return null;
  }

  return monthlyValues;
}

export function useDwdMonthlyTemperature({ lat, lon, year: preferredYear, enabled }: UseDwdMonthlyTemperatureProps) {
  const { airTemperature } = useMapLayers();
  const [state, setState] = useState<MonthlyDataState>({
    loading: false,
    error: null,
    values: null,
    year: null,
    isFallback: false,
  });

  const lastFetchRef = useRef<{ lat?: number; lon?: number; aggregation?: AirTempAggregation; year?: number }>({});

  useEffect(() => {
    if (!enabled || lat === null || lon === null) {
      setState({ loading: false, error: null, values: null, year: null, isFallback: false });
      return;
    }

    const nowYear = new Date().getFullYear();
    const requestedYear = Number.isFinite(preferredYear as number) ? (preferredYear as number) : nowYear - 1;

    // Skip if already fetched for this location, aggregation and year
    if (
      lastFetchRef.current.lat === lat &&
      lastFetchRef.current.lon === lon &&
      lastFetchRef.current.aggregation === airTemperature.aggregation &&
      lastFetchRef.current.year === requestedYear &&
      state.values
    ) {
      return;
    }

    const fetchMonthlyData = async () => {
      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const variable = airTemperature.aggregation === 'daily_max' ? 'max' : 'mean';

        // Try requested year first
        let values = await fetchMonthlyForYear(lat, lon, requestedYear, variable);
        let usedYear = requestedYear;
        let isFallback = false;

        // Fallback: try previous year if no data
        if (!values && requestedYear > 2020) {
          const fallbackYear = requestedYear - 1;
          console.log('[useDwdMonthlyTemperature] Fallback to year', fallbackYear);
          values = await fetchMonthlyForYear(lat, lon, fallbackYear, variable);
          if (values) {
            usedYear = fallbackYear;
            isFallback = true;
          }
        }

        lastFetchRef.current = { lat, lon, aggregation: airTemperature.aggregation, year: requestedYear };
        
        setState({
          loading: false,
          error: null,
          values: values ?? null,
          year: values ? usedYear : null,
          isFallback,
        });

        console.log('[useDwdMonthlyTemperature] Monthly values loaded:', { values, usedYear, isFallback });
      } catch (err) {
        console.error('[useDwdMonthlyTemperature] Error:', err);
        setState({
          loading: false,
          error: err instanceof Error ? err.message : 'Fehler beim Laden der Monatsdaten',
          values: null,
          year: null,
          isFallback: false,
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
