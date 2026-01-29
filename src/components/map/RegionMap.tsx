// src/components/map/RegionMap.tsx
import { useRef, useEffect, useState, useCallback } from 'react';
import Map, { NavigationControl, ScaleControl, AttributionControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapOverlays } from '@/hooks/useMapOverlays';
import { useRegion } from '@/contexts/RegionContext';
import { useDwdTemperature } from '@/hooks/useDwdTemperature';
import { initDeckOverlay, finalizeDeckOverlay } from './DeckOverlayManager';
import { MAP_STYLES } from './basemapStyles';

// Overlays Imports
import AirTemperatureOverlay from './AirTemperatureOverlay';
import EcostressCompositeOverlay from './ecostress/EcostressCompositeOverlay';
import { GlobalLSTOverlay } from './GlobalLSTOverlay';

export default function RegionMap() {
  const mapRef = useRef<any>(null);
  const { selectedRegion } = useRegion();
  const { activeLayers, mapStyle } = useMapOverlays();
  const { data: tempData } = useDwdTemperature();
  const [isMapReady, setIsMapReady] = useState(false);

  // Sicherer Style-Zugriff
  // @ts-ignore
  const currentStyle = MAP_STYLES[mapStyle] || MAP_STYLES.LIGHT;

  const onMapLoad = useCallback((e: any) => {
    console.log('Map loaded');
    try {
      initDeckOverlay(e.target);
      setIsMapReady(true);
    } catch (err) {
      console.error('Deck init failed:', err);
    }
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      try { finalizeDeckOverlay(); } catch (e) { console.error(e); }
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-gray-100">
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
        attributionControl={false}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" />
        <AttributionControl customAttribution="Neotopia" position="bottom-right" />

        {/* Layer 1: Air Temp */}
        <AirTemperatureOverlay 
          visible={activeLayers.includes('air_temperature')}
          data={tempData?.grid}
        />

        {/* Layer 2: Deck GL (Composite) */}
        {isMapReady && (
          <>
            <EcostressCompositeOverlay 
              map={mapRef.current?.getMap()}
              visible={activeLayers.includes('ecostress')}
              regionBbox={selectedRegion?.bbox}
              allGranules={[]} 
            />
            <GlobalLSTOverlay map={mapRef.current?.getMap() ?? null} visible={activeLayers.includes('global_lst')} />
          </>
        )}
      </Map>
    </div>
  );
}
