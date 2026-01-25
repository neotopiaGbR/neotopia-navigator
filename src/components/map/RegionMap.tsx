import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '@/integrations/supabase/client';
import { useRegion, Region } from '@/contexts/RegionContext';

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

  const {
    regions,
    setRegions,
    selectedRegionId,
    setSelectedRegionId,
    hoveredRegionId,
    setHoveredRegionId,
  } = useRegion();

  // Fetch regions from Supabase
  useEffect(() => {
    const fetchRegions = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('regions')
        .select('id, name, geom');

      if (fetchError) {
        console.error('[Neotopia] Error fetching regions:', fetchError.message);
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      if (data) {
        const parsedRegions: Region[] = data.map((r: any) => ({
          id: r.id,
          name: r.name,
          geom: typeof r.geom === 'string' ? JSON.parse(r.geom) : r.geom,
        }));
        setRegions(parsedRegions);
      }

      setLoading(false);
    };

    fetchRegions();
  }, [setRegions]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      center: [10.4515, 51.1657], // Germany center
      zoom: 5,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Add regions to map when loaded
  useEffect(() => {
    if (!map.current || regions.length === 0) return;

    const addRegionsToMap = () => {
      if (!map.current) return;

      // Remove existing source/layers if they exist
      if (map.current.getSource('regions')) {
        map.current.removeLayer('regions-fill');
        map.current.removeLayer('regions-outline');
        map.current.removeLayer('regions-highlight');
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
    };

    if (map.current.isStyleLoaded()) {
      addRegionsToMap();
    } else {
      map.current.on('load', addRegionsToMap);
    }
  }, [regions, selectedRegionId, hoveredRegionId]);

  // Update paint properties when selection/hover changes
  useEffect(() => {
    if (!map.current || !map.current.getLayer('regions-fill')) return;

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
  }, [selectedRegionId, hoveredRegionId]);

  // Mouse interactions
  useEffect(() => {
    if (!map.current) return;

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (!map.current) return;

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
    };

    const handleMouseLeave = () => {
      if (map.current) {
        map.current.getCanvas().style.cursor = '';
      }
      setHoveredRegionId(null);
    };

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (!map.current) return;

      const features = map.current.queryRenderedFeatures(e.point, {
        layers: ['regions-fill'],
      });

      if (features.length > 0) {
        const featureId = features[0].properties?.id;
        if (featureId) {
          setSelectedRegionId(featureId === selectedRegionId ? null : featureId);
        }
      }
    };

    map.current.on('mousemove', 'regions-fill', handleMouseMove);
    map.current.on('mouseleave', 'regions-fill', handleMouseLeave);
    map.current.on('click', 'regions-fill', handleClick);

    return () => {
      if (map.current) {
        map.current.off('mousemove', 'regions-fill', handleMouseMove);
        map.current.off('mouseleave', 'regions-fill', handleMouseLeave);
        map.current.off('click', 'regions-fill', handleClick);
      }
    };
  }, [hoveredRegionId, selectedRegionId, setHoveredRegionId, setSelectedRegionId]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive">Fehler beim Laden der Regionen</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
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
    </div>
  );
};

export default RegionMap;
