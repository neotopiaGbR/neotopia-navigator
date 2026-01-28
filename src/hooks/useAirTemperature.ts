/**
 * useAirTemperature Hook
 * 
 * Fetches ERA5-Land 2m air temperature data for Germany.
 * Data is cached after first fetch and only refetched when aggregation changes.
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMapLayers, AirTemperatureData, AirTempAggregation } from '@/components/map/MapLayersContext';

interface ERA5Response {
  status: 'ok' | 'error' | 'no_data';
  data?: AirTemperatureData;
  attribution?: string;
  error?: string;
  message?: string;
}

export function useAirTemperature() {
  const {
    airTemperature,
    setAirTemperatureLoading,
    setAirTemperatureError,
    setAirTemperatureData,
  } = useMapLayers();

  const lastFetchRef = useRef<{ aggregation?: AirTempAggregation }>({});

  const fetchAirTemperature = useCallback(async () => {
    const { enabled, aggregation, data } = airTemperature;
    
    if (!enabled) return;
    
    // Skip if already fetched for this aggregation
    if (lastFetchRef.current.aggregation === aggregation && data) {
      console.log('[useAirTemperature] Using cached data for', aggregation);
      return;
    }

    console.log('[useAirTemperature] Fetching ERA5-Land data:', { aggregation });
    setAirTemperatureLoading(true);

    try {
      const { data: responseData, error } = await supabase.functions.invoke('get-era5-air-temperature', {
        body: { aggregation },
      });

      if (error) {
        throw new Error(error.message || 'Edge Function Fehler');
      }

      const response = responseData as ERA5Response;

      if (response.status === 'error') {
        setAirTemperatureError(response.error || 'Unbekannter Fehler');
        return;
      }

      if (response.status === 'no_data' || !response.data) {
        setAirTemperatureError(response.message || 'Keine Daten verfügbar');
        return;
      }

      lastFetchRef.current.aggregation = aggregation;
      setAirTemperatureData(response.data);
      
      console.log('[useAirTemperature] Data loaded:', {
        points: response.data.grid.length,
        period: response.data.period,
        normalization: response.data.normalization,
      });

    } catch (err) {
      console.error('[useAirTemperature] Error:', err);
      setAirTemperatureError(
        err instanceof Error ? err.message : 'Fehler beim Laden der Lufttemperatur-Daten'
      );
    }
  }, [airTemperature.enabled, airTemperature.aggregation, airTemperature.data, setAirTemperatureLoading, setAirTemperatureError, setAirTemperatureData]);

  // Fetch when enabled or aggregation changes
  useEffect(() => {
    if (!airTemperature.enabled) return;
    
    // Small delay to avoid rapid toggling
    const timeout = setTimeout(() => {
      fetchAirTemperature();
    }, 300);

    return () => clearTimeout(timeout);
  }, [airTemperature.enabled, airTemperature.aggregation, fetchAirTemperature]);

  // Reset cache when disabled
  useEffect(() => {
    if (!airTemperature.enabled) {
      lastFetchRef.current = {};
    }
  }, [airTemperature.enabled]);

  return {
    data: airTemperature.data,
    loading: airTemperature.loading,
    error: airTemperature.error,
    metadata: airTemperature.metadata,
    refetch: fetchAirTemperature,
  };
}
