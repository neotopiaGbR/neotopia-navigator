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

  // Bump this when the backend response format/behavior changes to invalidate client cache.
  const CLIENT_CACHE_VERSION = 2;

  const lastFetchRef = useRef<{ aggregation?: AirTempAggregation; cacheVersion?: number }>({});

  const looksLikeGermanyBounds = useCallback((bounds: [number, number, number, number]) => {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    // Very forgiving sanity box around Germany/central Europe.
    // Reject clearly wrong projections (e.g. lat ~76 / lon ~-23).
    return (
      Number.isFinite(minLon) &&
      Number.isFinite(minLat) &&
      Number.isFinite(maxLon) &&
      Number.isFinite(maxLat) &&
      minLat > 40 &&
      maxLat < 62 &&
      minLon > -15 &&
      maxLon < 35
    );
  }, []);

  const fetchDwdTemperature = useCallback(async (opts?: { force?: boolean }) => {
    const { enabled, aggregation, data } = airTemperature;
    const force = opts?.force === true;
    
    if (!enabled) return;
    
    // Skip if already fetched for this aggregation
    if (!force && lastFetchRef.current.aggregation === aggregation && lastFetchRef.current.cacheVersion === CLIENT_CACHE_VERSION && data) {
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

      // Sanity check: if projection is broken, the overlay renders far away ("no data shown").
      if (!looksLikeGermanyBounds(response.data.bounds)) {
        throw new Error(
          'DWD data returned implausible coordinates (projection mismatch). Please redeploy the latest get-dwd-temperature function and click refresh.'
        );
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
      lastFetchRef.current.cacheVersion = CLIENT_CACHE_VERSION;
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
  }, [airTemperature.enabled, airTemperature.aggregation, airTemperature.data, setAirTemperatureLoading, setAirTemperatureError, setAirTemperatureData, looksLikeGermanyBounds]);

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
    refetch: () => fetchDwdTemperature({ force: true }),
  };
}
