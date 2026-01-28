import React, { useRef, useEffect, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '@/integrations/supabase/client';
import { useRegion, Region } from '@/contexts/RegionContext';
import { useMapLayers } from './MapLayersContext';
import { useMapOverlays } from '@/hooks/useMapOverlays';
import { useDwdTemperature } from '@/hooks/useDwdTemperature';
import { getBasemapStyle } from './basemapStyles';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import LayersControl from './LayersControl';
import { GlobalLSTOverlay } from './GlobalLSTOverlay';
import { AirTemperatureOverlay } from './AirTemperatureOverlay';
import { AirTemperatureLegend } from './AirTemperatureLegend';
import { DwdTemperatureHealthCheck } from './DwdTemperatureHealthCheck';
import { EcostressCompositeOverlay, type CompositeMetadata } from './ecostress';
import LayerDiagnosticsPanel from './LayerDiagnosticsPanel';

const REGIONS_FETCH_TIMEOUT_MS = 10000;

// Show health check panel in development mode only
const isDev = import.meta.env.DEV;

const devLog = (tag: string, ...args: unknown[]) => {
  if (import.meta.env.DEV) {
    console.log(`[RegionMap:${tag}]`, ...args);
  }
};

const RegionMap: React.FC = () => {
  const { isAdmin } = useAuth();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [compositeMetadata, setCompositeMetadata] = useState<CompositeMetadata | null>(null);
  const {
    regions,
    setRegions,
    selectedRegionId,
    setSelectedRegionId,
    hoveredRegionId,
    setHoveredRegionId,
  } = useRegion();

  const { basemap, overlays, heatLayers, airTemperature } = useMapLayers();
  
  // Check if any overlay is enabled (to adjust region fill style)
  const anyOverlayEnabled = overlays.ecostress.enabled || overlays.floodRisk.enabled || airTemperature.enabled;
  
  // Heat layer enabled = show both global LST and optionally ECOSTRESS
  const heatOverlayEnabled = overlays.ecostress.enabled;
  
  // Initialize overlay data fetching
  useMapOverlays();
  
  // Initialize DWD temperature data fetching (replaces ERA5)
  useDwdTemperature();

  // Fetch regions from Supabase with timeout protection
  const fetchRegions = useCallback(async () => {
    devLog('REGIONS_FETCH_START', {});
    setLoading(true);
    setError(null);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('REGIONS_FETCH_TIMEOUT')), REGIONS_FETCH_TIMEOUT_MS);
    });

    try {
      const fetchPromise = supabase
        .from('regions')
        .select('id, name, geom');

      const { data, error: fetchError } = await Promise.race([
        fetchPromise,
        timeoutPromise,
      ]) as Awaited<typeof fetchPromise>;

      if (fetchError) {
        devLog('REGIONS_FETCH_ERROR', {
          code: fetchError.code,
          message: fetchError.message,
          hint: fetchError.hint,
        });
        setError(`Fehler: ${fetchError.message}`);
        setRegions([]);
        return;
      }

      if (!data || data.length === 0) {
        devLog('REGIONS_FETCH_OK', { count: 0 });
        setRegions([]);
        return;
      }

      const parsedRegions: Region[] = data.map((r: any) => ({
        id: r.id,
        name: r.name,
        geom: typeof r.geom === 'string' ? JSON.parse(r.geom) : r.geom,
      }));
      
      devLog('REGIONS_FETCH_OK', { count: parsedRegions.length });
      setRegions(parsedRegions);
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === 'REGIONS_FETCH_TIMEOUT';
      devLog('REGIONS_FETCH_ERROR', {
        type: isTimeout ? 'timeout' : 'network_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      setError(isTimeout 
        ? 'Zeitüberschreitung beim Laden der Regionen' 
        : 'Netzwerkfehler beim Laden der Regionen'
      );
      setRegions([]);
    } finally {
      setLoading(false);
    }
  }, [setRegions]);

  // Initial fetch
  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: getBasemapStyle(basemap),
        center: [10.4515, 51.1657],
        zoom: 5,
      });

      map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

      map.current.on('load', () => {
        devLog('MAP_READY', {});
        setMapReady(true);
      });

      map.current.on('error', (e) => {
        devLog('MAP_ERROR', { error: e.error });
      });
    } catch (err) {
      devLog('MAP_INIT_ERROR', { message: err instanceof Error ? err.message : 'Unknown' });
    }

    return () => {
      map.current?.remove();
      map.current = null;
      setMapReady(false);
    };
  }, []);

  // Update basemap when changed
  useEffect(() => {
    if (!map.current || !mapReady) return;
    
    const currentCenter = map.current.getCenter();
    const currentZoom = map.current.getZoom();
    
    map.current.setStyle(getBasemapStyle(basemap));
    
    // Restore position after style change
    map.current.once('style.load', () => {
      map.current?.setCenter(currentCenter);
      map.current?.setZoom(currentZoom);
      // Re-add regions after style change
      addRegionsToMap();
      // Re-add overlays
      updateOverlays();
    });
  }, [basemap, mapReady]);

  // Add regions to map
  const addRegionsToMap = useCallback(() => {
    if (!map.current || regions.length === 0) return;

    try {
      // Remove existing source/layers if they exist
      if (map.current.getSource('regions')) {
        if (map.current.getLayer('regions-fill')) map.current.removeLayer('regions-fill');
        if (map.current.getLayer('regions-outline')) map.current.removeLayer('regions-outline');
        if (map.current.getLayer('regions-highlight')) map.current.removeLayer('regions-highlight');
        map.current.removeSource('regions');
      }

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: regions.map((region) => ({
          type: 'Feature',
          id: region.id,
          properties: {
            id: region.id,
            name: region.name,
          },
          geometry: region.geom,
        })),
      };

      map.current.addSource('regions', {
        type: 'geojson',
        data: geojson,
      });

      map.current.addLayer({
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': [
            'case',
            ['==', ['get', 'id'], selectedRegionId || ''],
            anyOverlayEnabled ? 'rgba(0, 255, 0, 0)' : '#00ff00',
            ['==', ['get', 'id'], hoveredRegionId || ''],
            anyOverlayEnabled ? 'rgba(0, 255, 0, 0.1)' : 'rgba(0, 255, 0, 0.4)',
            anyOverlayEnabled ? 'rgba(0, 255, 0, 0)' : 'rgba(0, 255, 0, 0.15)',
          ],
          'fill-opacity': anyOverlayEnabled ? 0.3 : 0.8,
        },
      });

      map.current.addLayer({
        id: 'regions-outline',
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': '#00ff00',
          'line-width': [
            'case',
            ['==', ['get', 'id'], selectedRegionId || ''],
            3,
            ['==', ['get', 'id'], hoveredRegionId || ''],
            2,
            1,
          ],
        },
      });

      map.current.addLayer({
        id: 'regions-highlight',
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': '#ffffff',
          'line-width': 2,
          'line-dasharray': [2, 2],
        },
        filter: ['==', ['get', 'id'], selectedRegionId || ''],
      });

      devLog('REGIONS_RENDERED', { count: regions.length });
    } catch (err) {
      devLog('REGIONS_RENDER_ERROR', { message: err instanceof Error ? err.message : 'Unknown' });
    }
  }, [regions, selectedRegionId, hoveredRegionId, anyOverlayEnabled]);

  // Update overlays (WMS/XYZ layers)
  const updateOverlays = useCallback(() => {
    if (!map.current) return;

    // Handle Flood Risk overlay (WMS or XYZ)
    const floodLayerId = 'flood-risk-overlay';
    const floodSourceId = 'flood-risk-source';

    if (overlays.floodRisk.enabled && overlays.floodRisk.metadata?.layers) {
      const layers = overlays.floodRisk.metadata.layers as any[];
      // Prefer WMS, then XYZ
      const activeLayer = layers.find((l) => l.type === 'wms') || layers.find((l) => l.type === 'xyz' || l.key?.includes('gsw'));
      
      if (activeLayer) {
        // Remove existing if present
        if (map.current.getLayer(floodLayerId)) {
          map.current.removeLayer(floodLayerId);
        }
        if (map.current.getSource(floodSourceId)) {
          map.current.removeSource(floodSourceId);
        }

        let tilesUrl: string;
        
        if (activeLayer.type === 'wms' && activeLayer.layer_name) {
          // WMS source
          tilesUrl = `${activeLayer.url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${activeLayer.layer_name}&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256`;
        } else if (activeLayer.key === 'jrc_gsw_occurrence') {
          // JRC Global Surface Water - special XYZ pattern
          tilesUrl = `${activeLayer.url}/{z}/{x}/{y}.png`;
        } else {
          // Generic XYZ
          tilesUrl = activeLayer.url.includes('{z}') 
            ? activeLayer.url 
            : `${activeLayer.url}/{z}/{x}/{y}.png`;
        }

        map.current.addSource(floodSourceId, {
          type: 'raster',
          tiles: [tilesUrl],
          tileSize: 256,
          attribution: activeLayer.attribution,
        });

        // Add layer below regions
        const insertBeforeLayer = map.current.getLayer('regions-fill') ? 'regions-fill' : undefined;
        map.current.addLayer(
          {
            id: floodLayerId,
            type: 'raster',
            source: floodSourceId,
            paint: {
              'raster-opacity': overlays.floodRisk.opacity / 100,
            },
          },
          insertBeforeLayer
        );
        
        devLog('FLOOD_LAYER_ADDED', { key: activeLayer.key, url: tilesUrl });
      }
    } else {
      // Remove flood overlay if disabled
      if (map.current.getLayer(floodLayerId)) {
        map.current.removeLayer(floodLayerId);
      }
      if (map.current.getSource(floodSourceId)) {
        map.current.removeSource(floodSourceId);
      }
    }

    // ECOSTRESS Summer Composite is rendered via EcostressCompositeOverlay component
    // which performs client-side pixel aggregation (median/P90) of all granules
    // into a single stable heat map layer
    
    if (overlays.ecostress.enabled && overlays.ecostress.metadata?.allGranules) {
      devLog('ECOSTRESS_COMPOSITE_ENABLED', { 
        granuleCount: (overlays.ecostress.metadata.allGranules as any[])?.length,
      });
    }
  }, [overlays]);

  // Effect to add/update regions when ready or overlay mode changes
  useEffect(() => {
    if (!map.current || !mapReady || regions.length === 0) return;
    addRegionsToMap();
  }, [regions, mapReady, addRegionsToMap, anyOverlayEnabled]);

  // Effect to update overlays
  useEffect(() => {
    if (!map.current || !mapReady) return;
    
    // Wait for style to be loaded
    if (map.current.isStyleLoaded()) {
      updateOverlays();
    } else {
      map.current.once('style.load', updateOverlays);
    }
  }, [mapReady, overlays.floodRisk.enabled, overlays.floodRisk.opacity, overlays.floodRisk.metadata, overlays.ecostress.enabled, overlays.ecostress.opacity, overlays.ecostress.metadata, updateOverlays]);

  // Update paint properties when selection/hover changes
  useEffect(() => {
    if (!map.current || !map.current.getLayer('regions-fill')) return;

    try {
      map.current.setPaintProperty('regions-fill', 'fill-color', [
        'case',
        ['==', ['get', 'id'], selectedRegionId || ''],
        anyOverlayEnabled ? 'rgba(0, 255, 0, 0)' : '#00ff00',
        ['==', ['get', 'id'], hoveredRegionId || ''],
        anyOverlayEnabled ? 'rgba(0, 255, 0, 0.1)' : 'rgba(0, 255, 0, 0.4)',
        anyOverlayEnabled ? 'rgba(0, 255, 0, 0)' : 'rgba(0, 255, 0, 0.15)',
      ]);
      
      map.current.setPaintProperty('regions-fill', 'fill-opacity', anyOverlayEnabled ? 0.3 : 0.8);

      map.current.setPaintProperty('regions-outline', 'line-width', [
        'case',
        ['==', ['get', 'id'], selectedRegionId || ''],
        3,
        ['==', ['get', 'id'], hoveredRegionId || ''],
        2,
        1,
      ]);

      map.current.setFilter('regions-highlight', [
        '==',
        ['get', 'id'],
        selectedRegionId || '',
      ]);
    } catch (err) {
      devLog('PAINT_UPDATE_ERROR', { message: err instanceof Error ? err.message : 'Unknown' });
    }
  }, [selectedRegionId, hoveredRegionId, anyOverlayEnabled]);

  // Mouse interactions
  useEffect(() => {
    if (!map.current || !mapReady) return;

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (!map.current) return;

      try {
        const features = map.current.queryRenderedFeatures(e.point, {
          layers: ['regions-fill'],
        });

        if (features.length > 0) {
          map.current.getCanvas().style.cursor = 'pointer';
          const featureId = features[0].properties?.id;
          if (featureId && featureId !== hoveredRegionId) {
            setHoveredRegionId(featureId);
          }
        } else {
          map.current.getCanvas().style.cursor = '';
          if (hoveredRegionId) {
            setHoveredRegionId(null);
          }
        }
      } catch (err) {
        // Silently ignore interaction errors
      }
    };

    const handleMouseLeave = () => {
      if (map.current) {
        map.current.getCanvas().style.cursor = '';
      }
      setHoveredRegionId(null);
    };

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (!map.current) return;

      try {
        const features = map.current.queryRenderedFeatures(e.point, {
          layers: ['regions-fill'],
        });

        if (features.length > 0) {
          const featureId = features[0].properties?.id;
          if (featureId) {
            setSelectedRegionId(featureId === selectedRegionId ? null : featureId);
          }
        }
      } catch (err) {
        // Silently ignore click errors
      }
    };

    const attachListeners = () => {
      if (!map.current?.getLayer('regions-fill')) return;
      
      map.current.on('mousemove', 'regions-fill', handleMouseMove);
      map.current.on('mouseleave', 'regions-fill', handleMouseLeave);
      map.current.on('click', 'regions-fill', handleClick);
    };

    if (map.current.getLayer('regions-fill')) {
      attachListeners();
    }

    return () => {
      if (map.current) {
        try {
          map.current.off('mousemove', 'regions-fill', handleMouseMove);
          map.current.off('mouseleave', 'regions-fill', handleMouseLeave);
          map.current.off('click', 'regions-fill', handleClick);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    };
  }, [mapReady, regions.length, hoveredRegionId, selectedRegionId, setHoveredRegionId, setSelectedRegionId]);

  // Error state with retry button
  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive">Fehler beim Laden der Regionen</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={fetchRegions}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Erneut versuchen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainer} className="h-full w-full" />
      
      {/* Layers Control */}
      <LayersControl />
      
      {/* AIR TEMPERATURE LAYER - Germany only, renders BELOW other heat layers */}
      {mapReady && map.current && airTemperature.enabled && (
        <AirTemperatureOverlay
          map={map.current}
          visible={airTemperature.enabled}
          opacity={airTemperature.opacity / 100}
          data={airTemperature.data}
        />
      )}
      
      {/* AIR TEMPERATURE LEGEND - Top-right, always visible when layer enabled */}
      <AirTemperatureLegend
        visible={airTemperature.enabled}
        normalization={airTemperature.metadata?.normalization || null}
        aggregation={airTemperature.aggregation}
        year={airTemperature.metadata?.year}
        period={airTemperature.metadata?.period}
        pointCount={airTemperature.metadata?.pointCount}
        loading={airTemperature.loading}
        error={airTemperature.error}
      />
      
      {/* DWD TEMPERATURE HEALTH CHECK - Dev/Admin only */}
      <DwdTemperatureHealthCheck visible={isDev || isAdmin} />
      
      {/* LAYER DIAGNOSTICS PANEL - Dev/Admin only */}
      <LayerDiagnosticsPanel map={map.current} />
      
      {/* TIER 1: Global LST Base Layer (MODIS) - ALWAYS ON when heat enabled */}
      {mapReady && map.current && heatOverlayEnabled && (
        <GlobalLSTOverlay
          map={map.current}
          visible={heatLayers.globalLSTEnabled}
          opacity={heatLayers.globalLSTOpacity / 100}
        />
      )}
      
      {/* TIER 2: ECOSTRESS Summer Composite - SINGLE aggregated layer */}
      {/* Render when enabled AND we have granule data, regardless of 'match' status */}
      {mapReady && map.current && overlays.ecostress.enabled && (
        <EcostressCompositeOverlay
          map={map.current}
          visible={overlays.ecostress.enabled && overlays.ecostress.metadata?.status === 'match'}
          opacity={heatLayers.ecostressOpacity / 100}
          allGranules={overlays.ecostress.metadata?.allGranules as Array<{
            cog_url: string;
            cloud_mask_url?: string;
            datetime: string;
            granule_id: string;
            granule_bounds: [number, number, number, number];
            quality_score: number;
            coverage_percent: number;
            cloud_percent: number;
          }> | undefined}
          regionBbox={overlays.ecostress.metadata?.regionBbox as [number, number, number, number] | undefined}
          aggregationMethod={heatLayers.aggregationMethod}
          onMetadata={(metadata) => {
            setCompositeMetadata(metadata);
            if (metadata) {
              console.log('[RegionMap] Composite metadata:', {
                confidence: metadata.coverageConfidence.level,
                granules: metadata.successfulGranules,
                discarded: metadata.discardedGranules,
              });
            }
          }}
        />
      )}
      
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <div className="text-center">
            <div className="mb-2 text-2xl font-bold text-accent">N</div>
            <p className="text-muted-foreground">Lade Karte...</p>
          </div>
        </div>
      )}
      {!loading && regions.length === 0 && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <div className="text-center">
            <p className="text-muted-foreground">Keine Regionen verfügbar</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={fetchRegions}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Erneut laden
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegionMap;
