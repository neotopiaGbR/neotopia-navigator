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

interface NearestCandidate {
  granule_id: string;
  datetime: string;
  bounds: [number, number, number, number];
  distance_km: number;
  cloud_cover?: number;
}

interface EcostressResponse {
  status: 'match' | 'no_coverage' | 'no_data' | 'auth_required' | 'error';
  cog_url?: string;
  cloud_mask_url?: string;
  datetime?: string;
  granule_id?: string;
  granule_bounds?: [number, number, number, number];
  region_centroid?: { lat: number; lon: number };
  qc_notes?: string;
  message?: string;
  attribution?: string;
  value_unit?: string;
  colormap_suggestion?: string;
  error?: string;
  nearest_candidate?: NearestCandidate;
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
  message?: string;
  default_return_period?: number;
  available_return_periods?: number[];
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
    console.log('[useMapOverlays] fetchEcostress called', { 
      selectedRegionId: selectedRegion?.id,
      hasGeom: !!selectedRegion?.geom,
      enabled: overlays.ecostress.enabled 
    });
    
    if (!selectedRegion) {
      if (overlays.ecostress.enabled) {
        setOverlayError('ecostress', 'Bitte wählen Sie eine Region auf der Karte aus');
      }
      return;
    }
    
    if (!selectedRegion.geom) {
      setOverlayError('ecostress', 'Region-Geometrie nicht verfügbar');
      return;
    }

    // Get centroid and bbox from geometry
    const coords = getCentroidFromGeom(selectedRegion.geom);
    const bbox = getBboxFromGeom(selectedRegion.geom);
    
    if (!coords) {
      setOverlayError('ecostress', 'Region-Geometrie ungültig');
      return;
    }

    const fetchKey = `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`;
    console.log('[useMapOverlays] ECOSTRESS query:', { 
      centroid: { lat: coords.lat.toFixed(4), lon: coords.lon.toFixed(4) },
      bbox,
      regionId: selectedRegion.id,
    });
    
    if (lastFetchRef.current.ecostress === fetchKey) {
      console.log('[useMapOverlays] Skipping ECOSTRESS fetch - already fetched for this region');
      return;
    }

    setOverlayLoading('ecostress', true);

    try {
      const { data, error } = await supabase.functions.invoke('ecostress-latest-tile', {
        body: {
          lat: coords.lat,
          lon: coords.lon,
          region_bbox: bbox,
          date_from: getDateDaysAgo(365),
          date_to: new Date().toISOString().split('T')[0],
        },
      });

      if (error) {
        throw new Error(error.message || 'Edge Function Fehler');
      }

      const response = data as EcostressResponse;
      console.log('[useMapOverlays] ECOSTRESS response:', { status: response.status, hasMatch: !!response.cog_url });

      if (response.status === 'auth_required') {
        setOverlayError('ecostress', 'ECOSTRESS erfordert Earthdata-Zugangsdaten in Supabase Secrets');
        return;
      }

      if (response.status === 'error') {
        setOverlayError('ecostress', response.error || 'Unbekannter Fehler');
        return;
      }

      // NO COVERAGE - granule doesn't intersect region
      if (response.status === 'no_coverage' || response.status === 'no_data') {
        lastFetchRef.current.ecostress = fetchKey;
        setOverlayMetadata('ecostress', {
          status: 'no_coverage',
          message: response.message || 'Keine ECOSTRESS-Daten für diese Region verfügbar',
          nearestCandidate: response.nearest_candidate || null,
          attribution: response.attribution,
        });
        setOverlayLoading('ecostress', false);
        return;
      }

      // MATCH - granule intersects region
      if (response.status === 'match') {
        lastFetchRef.current.ecostress = fetchKey;
        setOverlayMetadata('ecostress', {
          status: 'match',
          cogUrl: response.cog_url,
          cloudMaskUrl: response.cloud_mask_url,
          acquisitionDatetime: response.datetime,
          granuleId: response.granule_id,
          granuleBounds: response.granule_bounds,
          regionCentroid: response.region_centroid,
          regionBbox: bbox, // Pass region bbox for client-side intersection check
          qcNotes: response.qc_notes,
          attribution: response.attribution,
          unit: response.value_unit,
          colormap: response.colormap_suggestion,
        });
        setOverlayLoading('ecostress', false);
        return;
      }

      // Unknown status - treat as error
      setOverlayError('ecostress', 'Unbekannter Antwortstatus');
      
    } catch (err) {
      console.error('[useMapOverlays] ECOSTRESS error:', err);
      setOverlayError(
        'ecostress',
        err instanceof Error ? err.message : 'Fehler beim Laden der ECOSTRESS-Daten'
      );
    }
  }, [selectedRegion, overlays.ecostress.enabled, setOverlayLoading, setOverlayError, setOverlayMetadata]);

  // Fetch Flood Risk layers when overlay is enabled
  const fetchFloodRisk = useCallback(async () => {
    console.log('[useMapOverlays] fetchFloodRisk called', { 
      selectedRegionId: selectedRegion?.id,
      hasGeom: !!selectedRegion?.geom,
      enabled: overlays.floodRisk.enabled 
    });
    
    if (!selectedRegion) {
      if (overlays.floodRisk.enabled) {
        setOverlayError('floodRisk', 'Bitte wählen Sie eine Region auf der Karte aus');
      }
      return;
    }

    if (!selectedRegion.geom) {
      setOverlayError('floodRisk', 'Region-Geometrie nicht verfügbar');
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

      if (!response.layers || response.layers.length === 0) {
        setOverlayError('floodRisk', response.message || 'Keine Hochwasser-Layer verfügbar');
        return;
      }

      lastFetchRef.current.floodRisk = fetchKey;
      setOverlayMetadata('floodRisk', {
        layers: response.layers,
        selectedReturnPeriod: response.default_return_period || 100,
        message: response.message,
      });
      console.log('[useMapOverlays] Flood risk layers loaded:', response.layers.length);
      setOverlayLoading('floodRisk', false);
    } catch (err) {
      console.error('[useMapOverlays] Flood risk error:', err);
      setOverlayError(
        'floodRisk',
        err instanceof Error ? err.message : 'Fehler beim Laden der Hochwasser-Daten'
      );
    }
  }, [selectedRegion, overlays.floodRisk.enabled, setOverlayLoading, setOverlayError, setOverlayMetadata]);

  // Reset cache when region changes
  useEffect(() => {
    lastFetchRef.current = {};
  }, [selectedRegion?.id]);

  // Effect for ECOSTRESS overlay
  useEffect(() => {
    if (!overlays.ecostress.enabled) return;

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

// Utility to get bounding box from GeoJSON geometry
function getBboxFromGeom(geom: GeoJSON.Geometry): [number, number, number, number] | null {
  try {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;

    function processCoords(coords: number[]) {
      if (coords[0] < minLon) minLon = coords[0];
      if (coords[0] > maxLon) maxLon = coords[0];
      if (coords[1] < minLat) minLat = coords[1];
      if (coords[1] > maxLat) maxLat = coords[1];
    }

    if (geom.type === 'Point') {
      processCoords(geom.coordinates);
    } else if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) {
        for (const coord of ring) {
          processCoords(coord);
        }
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            processCoords(coord);
          }
        }
      }
    }

    if (minLon === Infinity) return null;
    return [minLon, minLat, maxLon, maxLat];
  } catch {
    return null;
  }
}

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}
