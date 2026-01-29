import { useRef, useEffect, useState, useCallback } from 'react';
import Map, { NavigationControl, ScaleControl, AttributionControl, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapOverlays } from '@/hooks/useMapOverlays';
import { useRegionContext } from '@/contexts/RegionContext';
import { useDwdTemperature } from '@/hooks/useDwdTemperature';
import { initDeckOverlay, finalizeDeckOverlay } from './DeckOverlayManager';
import { MAP_STYLES } from './basemapStyles';

// Overlays
import AirTemperatureOverlay from './AirTemperatureOverlay';
import EcostressCompositeOverlay from './ecostress/EcostressCompositeOverlay';
import GlobalLSTOverlay from './GlobalLSTOverlay';

export default function RegionMap() {
  const mapRef = useRef<MapRef>(null);
  const { selectedRegion } = useRegionContext();
  const { activeLayers, mapStyle } = useMapOverlays();
  
  // Data Fetching
  const { data: tempData } = useDwdTemperature();
  
  const [isMapReady, setIsMapReady] = useState(false);

  // 1. Initial Load
  const onMapLoad = useCallback((e: any) => {
    console.log('[RegionMap] Map Loaded');
    initDeckOverlay(e.target);
    setIsMapReady(true);
  }, []);

  // 2. Style Change Handling (Critical for Satellite switch)
  const onStyleData = useCallback((e: any) => {
    // Only re-init if it's a style loading event and map exists
    if (e.dataType === 'style' && mapRef.current) {
      initDeckOverlay(mapRef.current.getMap(), true); // Force re-init
    }
  }, []);

  useEffect(() => {
    return () => finalizeDeckOverlay();
  }, []);

  // Safe Style URL access
  // @ts-ignore
  const currentStyle = MAP_STYLES[mapStyle] || MAP_STYLES.LIGHT;

  return (
    <div className="relative w-full h-full bg-slate-100">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 10.45,
          latitude: 51.16,
          zoom: 5.5
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={currentStyle}
        onLoad={onMapLoad}
        onStyleData={onStyleData}
        attributionControl={false}
        reuseMaps
      >
        <AttributionControl customAttribution="Neotopia Navigator" position="bottom-right" />
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" />

        {/* --- Standard MapLibre Layers --- */}
        <AirTemperatureOverlay 
          visible={activeLayers.includes('air_temperature')}
          data={tempData?.grid}
        />

        {/* --- Deck.gl Overlays (Logic Only) --- */}
        {isMapReady && (
          <>
            <EcostressCompositeOverlay 
              map={mapRef.current?.getMap()}
              visible={activeLayers.includes('ecostress')}
              regionBbox={selectedRegion?.bbox}
              // Add granules here if available from context
              allGranules={[]} 
            />
            
            <GlobalLSTOverlay visible={activeLayers.includes('global_lst')} />
          </>
        )}
      </Map>
    </div>
  );
}
