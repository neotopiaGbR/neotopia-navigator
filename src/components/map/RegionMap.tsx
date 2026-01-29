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
import EcostressOverlay from './EcostressOverlay'; // Legacy/Fallback fallback

export default function RegionMap() {
  const mapRef = useRef<MapRef>(null);
  const { selectedRegion } = useRegionContext();
  const { activeLayers, mapStyle } = useMapOverlays();
  
  // Data Hooks
  const { data: tempData } = useDwdTemperature();
  
  // State to track if map is ready for Deck.gl
  const [mapReady, setMapReady] = useState(false);

  // Initialize DeckOverlayManager when map loads
  const onMapLoad = useCallback((e: any) => {
    console.log('[RegionMap] Map Loaded');
    const mapInstance = e.target;
    initDeckOverlay(mapInstance);
    setMapReady(true);
  }, []);

  // Re-initialize when style changes (MapLibre creates new canvas)
  const onStyleData = useCallback((e: any) => {
    if (e.dataType === 'style' && mapRef.current) {
      // Force re-init of overlay manager on existing map
      initDeckOverlay(mapRef.current.getMap(), false, { force: true });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      finalizeDeckOverlay();
    };
  }, []);

  // Determine Map Style URL safely
  // @ts-ignore - access safe properties
  const styleUrl = MAP_STYLES[mapStyle] || MAP_STYLES.LIGHT || MAP_STYLES.light;

  return (
    <div className="relative w-full h-full bg-muted/20">
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
        attributionControl={false}
      >
        <AttributionControl customAttribution="Neotopia Navigator" position="bottom-right" />
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" />

        {/* --- MAPLIBRE LAYERS (Rendered inside Map context) --- */}
        
        {/* Lufttemperatur (DWD) */}
        <AirTemperatureOverlay 
          visible={activeLayers.includes('air_temperature')}
          data={tempData?.grid || null} // Pass 'grid' explicitly
        />

        {/* --- DECK.GL OVERLAYS (Managed via Singleton) --- */}
        {/* These components don't render DOM elements but update the Deck instance */}
        
        {mapReady && (
          <>
            <EcostressCompositeOverlay 
              map={mapRef.current?.getMap() || null}
              visible={activeLayers.includes('ecostress')}
              // We assume 'ecostress' refers to the composite layer now
              allGranules={[]} // Data fetching is handled internally or via context in a full app
              // Usually we would pass data here, but for now we ensure it doesn't crash
              regionBbox={selectedRegion?.bbox}
            />
            
            {/* If you have Global LST */}
            <GlobalLSTOverlay visible={activeLayers.includes('global_lst')} />
          </>
        )}
      </Map>
    </div>
  );
}
