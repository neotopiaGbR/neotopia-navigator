/**
 * useMapOverlays Hook
 * 
 * Manages fetching and state for map overlay data (ECOSTRESS, Flood Risk)
 * Uses Supabase Edge Functions for backend logic
 */

import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMapLayers } from '@/components/map/MapLayersContext';
import { useRegion } from '@/contexts/RegionContext';

interface EcostressResponse {
  status: 'ok' | 'no_data' | 'auth_required' | 'error';
  cog_url?: string;
  cloud_mask_url?: string;
  datetime?: string;
  qc_notes?: string;
  attribution?: string;
  value_unit?: string;
  colormap_suggestion?: string;
  error?: string;
}

interface FloodRiskLayer {
  key: string;
  name: string;
  type: 'wms' | 'xyz' | 'geotiff';
  url: string;
  layer_name?: string;
  attribution: string;
  return_period?: number;
}

interface FloodRiskResponse {
  status: 'ok' | 'error';
  layers?: FloodRiskLayer[];
  error?: string;
}

const DEBOUNCE_MS = 500;

export function useMapOverlays() {
  const { selectedRegion } = useRegion();
  const {
    overlays,
    setOverlayLoading,
    setOverlayError,
    setOverlayMetadata,
  } = useMapLayers();

  const lastFetchRef = useRef<{ ecostress?: string; floodRisk?: string }>({});
  const debounceRef = useRef<{ ecostress?: ReturnType<typeof setTimeout>; floodRisk?: ReturnType<typeof setTimeout> }>({});

  // Fetch ECOSTRESS data when overlay is enabled
  const fetchEcostress = useCallback(async () => {
    if (!selectedRegion?.geom) {
      setOverlayError('ecostress', 'Keine Region ausgewählt');
      return;
    }

    // Get centroid from geometry
    const coords = getCentroidFromGeom(selectedRegion.geom);
    if (!coords) {
      setOverlayError('ecostress', 'Region-Geometrie ungültig');
      return;
    }

    // Check if we already fetched for this region
    const fetchKey = `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`;
    if (lastFetchRef.current.ecostress === fetchKey) {
      return;
    }

    setOverlayLoading('ecostress', true);

    try {
      const { data, error } = await supabase.functions.invoke('ecostress-latest-tile', {
        body: {
          lat: coords.lat,
          lon: coords.lon,
          date_from: getDateDaysAgo(21),
          date_to: new Date().toISOString().split('T')[0],
        },
      });

      if (error) {
        throw new Error(error.message || 'Edge Function Fehler');
      }

      const response = data as EcostressResponse;

      if (response.status === 'auth_required') {
        setOverlayError('ecostress', 'ECOSTRESS erfordert Earthdata-Zugangsdaten in Supabase Secrets');
        return;
      }

      if (response.status === 'no_data') {
        setOverlayError('ecostress', response.qc_notes || 'Keine ECOSTRESS-Daten für diese Region verfügbar');
        return;
      }

      if (response.status === 'error') {
        setOverlayError('ecostress', response.error || 'Unbekannter Fehler');
        return;
      }

      // Success
      lastFetchRef.current.ecostress = fetchKey;
      setOverlayMetadata('ecostress', {
        cogUrl: response.cog_url,
        cloudMaskUrl: response.cloud_mask_url,
        acquisitionDatetime: response.datetime,
        qcNotes: response.qc_notes,
        attribution: response.attribution,
        unit: response.value_unit,
        colormap: response.colormap_suggestion,
      });
      setOverlayLoading('ecostress', false);
    } catch (err) {
      console.error('[useMapOverlays] ECOSTRESS error:', err);
      setOverlayError(
        'ecostress',
        err instanceof Error ? err.message : 'Fehler beim Laden der ECOSTRESS-Daten'
      );
    }
  }, [selectedRegion, setOverlayLoading, setOverlayError, setOverlayMetadata]);

  // Fetch Flood Risk layers when overlay is enabled
  const fetchFloodRisk = useCallback(async () => {
    if (!selectedRegion?.geom) {
      setOverlayError('floodRisk', 'Keine Region ausgewählt');
      return;
    }

    const coords = getCentroidFromGeom(selectedRegion.geom);
    if (!coords) {
      setOverlayError('floodRisk', 'Region-Geometrie ungültig');
      return;
    }

    const fetchKey = `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`;
    if (lastFetchRef.current.floodRisk === fetchKey) {
      return;
    }

    setOverlayLoading('floodRisk', true);

    try {
      const { data, error } = await supabase.functions.invoke('get-flood-risk-layers', {
        body: {
          lat: coords.lat,
          lon: coords.lon,
        },
      });

      if (error) {
        throw new Error(error.message || 'Edge Function Fehler');
      }

      const response = data as FloodRiskResponse;

      if (response.status === 'error') {
        setOverlayError('floodRisk', response.error || 'Unbekannter Fehler');
        return;
      }

      lastFetchRef.current.floodRisk = fetchKey;
      setOverlayMetadata('floodRisk', {
        layers: response.layers,
        selectedReturnPeriod: 100,
      });
      setOverlayLoading('floodRisk', false);
    } catch (err) {
      console.error('[useMapOverlays] Flood risk error:', err);
      setOverlayError(
        'floodRisk',
        err instanceof Error ? err.message : 'Fehler beim Laden der Hochwasser-Daten'
      );
    }
  }, [selectedRegion, setOverlayLoading, setOverlayError, setOverlayMetadata]);

  // Effect for ECOSTRESS overlay
  useEffect(() => {
    if (!overlays.ecostress.enabled) return;

    // Clear existing debounce
    if (debounceRef.current.ecostress) {
      clearTimeout(debounceRef.current.ecostress);
    }

    debounceRef.current.ecostress = setTimeout(() => {
      fetchEcostress();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current.ecostress) {
        clearTimeout(debounceRef.current.ecostress);
      }
    };
  }, [overlays.ecostress.enabled, selectedRegion?.id, fetchEcostress]);

  // Effect for Flood Risk overlay
  useEffect(() => {
    if (!overlays.floodRisk.enabled) return;

    if (debounceRef.current.floodRisk) {
      clearTimeout(debounceRef.current.floodRisk);
    }

    debounceRef.current.floodRisk = setTimeout(() => {
      fetchFloodRisk();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current.floodRisk) {
        clearTimeout(debounceRef.current.floodRisk);
      }
    };
  }, [overlays.floodRisk.enabled, selectedRegion?.id, fetchFloodRisk]);

  return {
    ecostressMetadata: overlays.ecostress.metadata,
    floodRiskMetadata: overlays.floodRisk.metadata,
    refetchEcostress: fetchEcostress,
    refetchFloodRisk: fetchFloodRisk,
  };
}

// Utility to get centroid from GeoJSON geometry
function getCentroidFromGeom(geom: GeoJSON.Geometry): { lat: number; lon: number } | null {
  try {
    if (geom.type === 'Point') {
      return { lon: geom.coordinates[0], lat: geom.coordinates[1] };
    }

    if (geom.type === 'Polygon') {
      const coords = geom.coordinates[0];
      const sumLon = coords.reduce((sum, c) => sum + c[0], 0);
      const sumLat = coords.reduce((sum, c) => sum + c[1], 0);
      return { lon: sumLon / coords.length, lat: sumLat / coords.length };
    }

    if (geom.type === 'MultiPolygon') {
      let totalLon = 0;
      let totalLat = 0;
      let count = 0;
      for (const polygon of geom.coordinates) {
        for (const coord of polygon[0]) {
          totalLon += coord[0];
          totalLat += coord[1];
          count++;
        }
      }
      if (count === 0) return null;
      return { lon: totalLon / count, lat: totalLat / count };
    }

    return null;
  } catch {
    return null;
  }
}

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}
