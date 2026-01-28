/**
 * useDwdTemperature Hook
 * 
 * Fetches DWD HYRAS-DE 1km air temperature data for Germany.
 * Data is cached after first fetch and only refetched when variable changes.
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_URL } from '@/integrations/supabase/client';
import { useMapLayers, AirTemperatureData, AirTempAggregation } from '@/components/map/MapLayersContext';

interface DwdResponse {
  status: 'ok' | 'error' | 'no_data';
  data?: {
    grid: Array<{ lat: number; lon: number; value: number }>;
    bounds: [number, number, number, number];
    year: number;
    variable: string;
    season: string;
    period: string;
    resolution_km: number;
    cellsize_m: number;
    normalization: {
      p5: number;
      p95: number;
      min: number;
      max: number;
    };
    gridMetadata: {
      ncols: number;
      nrows: number;
      xllcorner: number;
      yllcorner: number;
      cellsize: number;
      sampleStep: number;
    };
  };
  attribution?: string;
  error?: string;
  message?: string;
}

export function useDwdTemperature() {
  const {
    airTemperature,
    setAirTemperatureLoading,
    setAirTemperatureError,
    setAirTemperatureData,
  } = useMapLayers();

  const lastFetchRef = useRef<{ aggregation?: AirTempAggregation }>({});

  const fetchDwdTemperature = useCallback(async () => {
    const { enabled, aggregation, data } = airTemperature;
    
    if (!enabled) return;
    
    // Skip if already fetched for this aggregation
    if (lastFetchRef.current.aggregation === aggregation && data) {
      console.log('[useDwdTemperature] Using cached data for', aggregation);
      return;
    }

    // Map our aggregation types to DWD variable names
    const variable = aggregation === 'daily_max' ? 'max' : 'mean';
    
    console.log('[useDwdTemperature] Fetching DWD data:', { variable, aggregation });
    setAirTemperatureLoading(true);

    try {
      const endpointUrl = `${SUPABASE_URL}/functions/v1/get-dwd-temperature`;
      console.log('[useDwdTemperature] Invoking Edge Function:', endpointUrl);

      const { data: responseData, error } = await supabase.functions.invoke('get-dwd-temperature', {
        body: { 
          variable,
          sample: 3, // Sample every 3rd cell for ~63k points instead of 566k
        },
      });

      if (error) {
        // Supabase JS frequently collapses network/CORS failures into this generic message.
        const msg = error.message || 'Edge Function Fehler';
        if (msg.includes('Failed to send a request to the Edge Function')) {
          throw new Error(`Edge Function unreachable (network/CORS or not deployed). Endpoint: ${endpointUrl}`);
        }
        throw new Error(msg);
      }

      const response = responseData as DwdResponse;

      if (response.status === 'error') {
        setAirTemperatureError(response.error || 'Unbekannter Fehler');
        return;
      }

      if (response.status === 'no_data' || !response.data) {
        setAirTemperatureError(response.message || 'Keine Daten verfügbar');
        return;
      }

      // Convert DWD response to our AirTemperatureData format
      const airTempData: AirTemperatureData = {
        grid: response.data.grid,
        bounds: response.data.bounds,
        year: response.data.year,
        aggregation: aggregation,
        period: response.data.period,
        resolution_km: response.data.resolution_km,
        normalization: response.data.normalization,
      };

      lastFetchRef.current.aggregation = aggregation;
      setAirTemperatureData(airTempData);
      
      console.log('[useDwdTemperature] Data loaded:', {
        points: response.data.grid.length,
        period: response.data.period,
        normalization: response.data.normalization,
        attribution: response.attribution,
      });

    } catch (err) {
      console.error('[useDwdTemperature] Error:', err);
      setAirTemperatureError(
        err instanceof Error ? err.message : 'Fehler beim Laden der DWD-Temperaturdaten'
      );
    } finally {
      setAirTemperatureLoading(false);
    }
  }, [airTemperature.enabled, airTemperature.aggregation, airTemperature.data, setAirTemperatureLoading, setAirTemperatureError, setAirTemperatureData]);

  // Fetch when enabled or aggregation changes
  useEffect(() => {
    if (!airTemperature.enabled) return;
    
    // Small delay to avoid rapid toggling
    const timeout = setTimeout(() => {
      fetchDwdTemperature();
    }, 300);

    return () => clearTimeout(timeout);
  }, [airTemperature.enabled, airTemperature.aggregation, fetchDwdTemperature]);

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
    refetch: fetchDwdTemperature,
  };
}
