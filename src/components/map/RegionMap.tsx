import { useRef, useEffect, useState, useCallback } from 'react';
import Map, { NavigationControl, ScaleControl, AttributionControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection, Feature, Geometry } from 'geojson';

import { useMapOverlays } from '@/hooks/useMapOverlays';
import { useRegion } from '@/contexts/RegionContext';
import { useDwdTemperature } from '@/hooks/useDwdTemperature';
import { initDeckOverlay, finalizeDeckOverlay } from './DeckOverlayManager';
import { MAP_STYLES } from './basemapStyles';

import AirTemperatureOverlay from './AirTemperatureOverlay';
import { EcostressCompositeOverlay } from './ecostress/EcostressCompositeOverlay';
import GlobalLSTOverlay from './GlobalLSTOverlay';

import LayersControl from './LayersControl';
import OverlayDiagnosticsPanel from './OverlayDiagnosticsPanel';

export default function RegionMap() {
  const mapRef = useRef<MapRef>(null);
  const { 
    regions, 
    selectedRegionId, 
    setSelectedRegionId, 
    hoveredRegionId, 
    setHoveredRegionId,
    selectedRegion 
  } = useRegion();
  const { activeLayers, mapStyle } = useMapOverlays();
  const { data: tempData } = useDwdTemperature();
  
  const [isMapReady, setIsMapReady] = useState(false);

  // @ts-ignore
  const styleUrl = MAP_STYLES[mapStyle] || MAP_STYLES.LIGHT || MAP_STYLES.light;

  // Convert regions to GeoJSON FeatureCollection
  const regionsGeoJson: FeatureCollection = {
    type: 'FeatureCollection',
    features: regions.map((region): Feature => ({
      type: 'Feature',
      id: region.id,
      properties: {
        id: region.id,
        name: region.name,
      },
      geometry: region.geom as Geometry,
    })),
  };

  const onMapLoad = useCallback((e: any) => {
    console.log('[RegionMap] Map Loaded');
    initDeckOverlay(e.target);
    setIsMapReady(true);
  }, []);

  const onStyleData = useCallback((e: any) => {
    if (e.dataType === 'style' && mapRef.current) {
      initDeckOverlay(mapRef.current.getMap(), true);
    }
  }, []);

  // Handle map click on regions
  const handleMapClick = useCallback((e: any) => {
    const features = e.features;
    if (features && features.length > 0) {
      const clickedRegion = features[0];
      const regionId = clickedRegion.properties?.id;
      if (regionId) {
        setSelectedRegionId(regionId);
      }
    }
  }, [setSelectedRegionId]);

  // Handle mouse move for hover effect
  const handleMouseMove = useCallback((e: any) => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const features = e.features;
    if (features && features.length > 0) {
      const hoveredId = features[0].properties?.id;
      if (hoveredId !== hoveredRegionId) {
        setHoveredRegionId(hoveredId);
      }
      map.getCanvas().style.cursor = 'pointer';
    }
  }, [hoveredRegionId, setHoveredRegionId]);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    
    setHoveredRegionId(null);
    map.getCanvas().style.cursor = '';
  }, [setHoveredRegionId]);

  useEffect(() => {
    return () => finalizeDeckOverlay();
  }, []);

  // Fly to selected region when it changes
  useEffect(() => {
    if (!selectedRegion || !mapRef.current) return;
    
    const bbox = selectedRegion.bbox;
    if (bbox) {
      mapRef.current.fitBounds(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        { padding: 100, duration: 1000 }
      );
    }
  }, [selectedRegion?.id]);

  return (
    <div className="relative w-full h-full bg-background overflow-hidden">
      
      {/* KARTE */}
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 10.45,
          latitude: 51.16,
          zoom: 5.5
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={styleUrl}
        onLoad={onMapLoad}
        onStyleData={onStyleData}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        interactiveLayerIds={['regions-fill']}
        attributionControl={false}
        reuseMaps
      >
        <AttributionControl customAttribution="Neotopia Navigator" position="bottom-right" />
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" />

        {/* Region Tiles */}
        {regions.length > 0 && (
          <Source id="regions-source" type="geojson" data={regionsGeoJson}>
            {/* Fill Layer */}
            <Layer
              id="regions-fill"
              type="fill"
              paint={{
                'fill-color': [
                  'case',
                  ['==', ['get', 'id'], selectedRegionId ?? ''],
                  'hsl(var(--accent))',
                  ['==', ['get', 'id'], hoveredRegionId ?? ''],
                  'hsl(var(--accent) / 0.6)',
                  'hsl(var(--accent) / 0.2)',
                ],
                'fill-opacity': 0.4,
              }}
            />
            {/* Outline Layer */}
            <Layer
              id="regions-outline"
              type="line"
              paint={{
                'line-color': [
                  'case',
                  ['==', ['get', 'id'], selectedRegionId ?? ''],
                  'hsl(var(--accent))',
                  'hsl(var(--accent) / 0.6)',
                ],
                'line-width': [
                  'case',
                  ['==', ['get', 'id'], selectedRegionId ?? ''],
                  3,
                  1.5,
                ],
              }}
            />
          </Source>
        )}

        {/* Air Temperature Overlay */}
        <AirTemperatureOverlay 
          visible={activeLayers.includes('air_temperature')}
          data={tempData?.grid}
        />
      </Map>

      {/* LOGIK-LAYER (Außerhalb der Map um Refs-Fehler zu vermeiden) */}
      {isMapReady && mapRef.current && (
        <>
          <EcostressCompositeOverlay 
            visible={activeLayers.includes('ecostress')}
            regionBbox={selectedRegion?.bbox}
            allGranules={[]} 
          />
          <GlobalLSTOverlay 
            map={mapRef.current.getMap()} 
            visible={activeLayers.includes('global_lst')} 
          />
        </>
      )}

      {/* Ebenen-Button (unten links gemäß Design) */}
      <div className="absolute bottom-8 left-4 z-20 pointer-events-auto">
        <LayersControl />
      </div>

      {/* Diagnostics Panel (unten rechts) */}
      <div className="absolute bottom-8 right-4 z-20 pointer-events-auto">
        <OverlayDiagnosticsPanel visible={true} mapRef={mapRef} />
      </div>

    </div>
  );
}
