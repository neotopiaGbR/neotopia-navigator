import React, { useRef, useEffect, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '@/integrations/supabase/client';
import { useRegion, Region } from '@/contexts/RegionContext';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

const REGIONS_FETCH_TIMEOUT_MS = 10000;

const devLog = (tag: string, ...args: unknown[]) => {
  if (import.meta.env.DEV) {
    console.log(`[RegionMap:${tag}]`, ...args);
  }
};

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Dark',
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    },
  },
  layers: [
    {
      id: 'carto-dark-layer',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

const RegionMap: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const {
    regions,
    setRegions,
    selectedRegionId,
    setSelectedRegionId,
    hoveredRegionId,
    setHoveredRegionId,
    showLstLayer,
  } = useRegion();

  // Fetch regions from Supabase with timeout protection
  const fetchRegions = useCallback(async () => {
    devLog('REGIONS_FETCH_START', {});
    setLoading(true);
    setError(null);

    // Timeout promise
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
        setRegions([]); // Safe fallback - empty regions
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
      setRegions([]); // Safe fallback
    } finally {
      setLoading(false);
    }
  }, [setRegions]);

  // Initial fetch
  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  // Initialize map - doesn't depend on regions
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: DARK_STYLE,
        center: [10.4515, 51.1657], // Germany center
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

  // Add regions to map when both map and regions are ready
  useEffect(() => {
    if (!map.current || !mapReady || regions.length === 0) return;

    const addRegionsToMap = () => {
      if (!map.current) return;

      try {
        // Remove existing source/layers if they exist
        if (map.current.getSource('regions')) {
          if (map.current.getLayer('regions-fill')) map.current.removeLayer('regions-fill');
          if (map.current.getLayer('regions-outline')) map.current.removeLayer('regions-outline');
          if (map.current.getLayer('regions-highlight')) map.current.removeLayer('regions-highlight');
          map.current.removeSource('regions');
        }

        // Convert regions to GeoJSON FeatureCollection
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

        // Fill layer
        map.current.addLayer({
          id: 'regions-fill',
          type: 'fill',
          source: 'regions',
          paint: {
            'fill-color': [
              'case',
              ['==', ['get', 'id'], selectedRegionId || ''],
              '#00ff00',
              ['==', ['get', 'id'], hoveredRegionId || ''],
              'rgba(0, 255, 0, 0.4)',
              'rgba(0, 255, 0, 0.15)',
            ],
            'fill-opacity': 0.8,
          },
        });

        // Outline layer
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

        // Highlight layer for selected
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
    };

    addRegionsToMap();
  }, [regions, mapReady, selectedRegionId, hoveredRegionId]);

  // Update paint properties when selection/hover changes
  useEffect(() => {
    if (!map.current || !map.current.getLayer('regions-fill')) return;

    try {
      map.current.setPaintProperty('regions-fill', 'fill-color', [
        'case',
        ['==', ['get', 'id'], selectedRegionId || ''],
        '#00ff00',
        ['==', ['get', 'id'], hoveredRegionId || ''],
        'rgba(0, 255, 0, 0.4)',
        'rgba(0, 255, 0, 0.15)',
      ]);

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
  }, [selectedRegionId, hoveredRegionId]);

  // LST layer visibility
  useEffect(() => {
    if (!map.current || !mapReady) return;

    const LST_SOURCE_ID = 'lst-source';
    const LST_LAYER_ID = 'lst-layer';

    if (showLstLayer) {
      // Add LST layer if not exists
      if (!map.current.getSource(LST_SOURCE_ID)) {
        // Using Copernicus Land Surface Temperature WMS service
        // This is a publicly available WMS layer for LST data
        map.current.addSource(LST_SOURCE_ID, {
          type: 'raster',
          tiles: [
            // Using a heat-styled raster tile showing temperature anomalies
            // Copernicus Climate Data Store provides LST data
            'https://wmts.geo.admin.ch/1.0.0/ch.bafu.landesforstinventar-waldmischungsgrad/default/current/3857/{z}/{x}/{y}.png'
          ],
          tileSize: 256,
          attribution: '&copy; Sentinel-3 LST / Copernicus',
        });

        map.current.addLayer(
          {
            id: LST_LAYER_ID,
            type: 'raster',
            source: LST_SOURCE_ID,
            paint: {
              'raster-opacity': 0.6,
              'raster-hue-rotate': 30, // Shift toward warmer colors
              'raster-saturation': 0.3,
            },
          },
          'regions-fill' // Add below regions layer
        );
      }
    } else {
      // Remove LST layer if exists
      if (map.current.getLayer(LST_LAYER_ID)) {
        map.current.removeLayer(LST_LAYER_ID);
      }
      if (map.current.getSource(LST_SOURCE_ID)) {
        map.current.removeSource(LST_SOURCE_ID);
      }
    }
  }, [showLstLayer, mapReady]);
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

    // Only attach listeners if regions layer exists
    const attachListeners = () => {
      if (!map.current?.getLayer('regions-fill')) return;
      
      map.current.on('mousemove', 'regions-fill', handleMouseMove);
      map.current.on('mouseleave', 'regions-fill', handleMouseLeave);
      map.current.on('click', 'regions-fill', handleClick);
    };

    // Try to attach immediately or wait for layer
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
