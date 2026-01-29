import { useRef, useEffect, useState, useCallback } from 'react';
import Map, { NavigationControl, ScaleControl, AttributionControl, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

// Hooks & Contexts
import { useMapOverlays } from '@/hooks/useMapOverlays';
import { useRegion } from '@/contexts/RegionContext';
import { useDwdTemperature } from '@/hooks/useDwdTemperature';
import { initDeckOverlay, finalizeDeckOverlay } from './DeckOverlayManager';
import { MAP_STYLES } from './basemapStyles';

// Map Layers
import AirTemperatureOverlay from './AirTemperatureOverlay';
import EcostressCompositeOverlay from './ecostress/EcostressCompositeOverlay';
import GlobalLSTOverlay from './GlobalLSTOverlay';

// UI Tools
import RegionSidebar from './RegionSidebar';
import LayersControl from './LayersControl';
import OverlayDiagnosticsPanel from './OverlayDiagnosticsPanel';

export default function RegionMap() {
  const mapRef = useRef<MapRef>(null);
  const { selectedRegion } = useRegion();
  const { activeLayers, mapStyle } = useMapOverlays();
  const { data: tempData } = useDwdTemperature();
  
  const [isMapReady, setIsMapReady] = useState(false);

  // Style URL sicher auflösen
  // @ts-ignore
  const styleUrl = MAP_STYLES[mapStyle] || MAP_STYLES.LIGHT || MAP_STYLES.light;

  // 1. Initialisierung
  const onMapLoad = useCallback((e: any) => {
    console.log('[RegionMap] Map Loaded');
    // Wir übergeben das rohe maplibre-Objekt an den Manager
    initDeckOverlay(e.target);
    setIsMapReady(true);
  }, []);

  // 2. Style-Wechsel (z.B. Satellit) zerstört den Canvas -> Re-Init nötig
  const onStyleData = useCallback((e: any) => {
    if (e.dataType === 'style' && mapRef.current) {
      initDeckOverlay(mapRef.current.getMap(), true);
    }
  }, []);

  // 3. Cleanup
  useEffect(() => {
    return () => finalizeDeckOverlay();
  }, []);

  return (
    <div className="relative w-full h-full bg-slate-100 overflow-hidden">
      
      {/* LAYER A: Die Karte */}
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
        reuseMaps
      >
        <AttributionControl customAttribution="Neotopia Navigator" position="bottom-right" />
        <NavigationControl position="top-right" style={{ marginRight: '50px' }} />
        <ScaleControl position="bottom-left" />

        {/* Native Layer (z.B. Punkte) MÜSSEN hier drin sein */}
        <AirTemperatureOverlay 
          visible={activeLayers.includes('air_temperature')}
          data={tempData?.grid}
        />
      </Map>

      {/* LAYER B: Deck.gl Overlays (Logik) 
          WICHTIG: Diese MÜSSEN hier draußen sein, sonst gibt es Ref-Fehler!
      */}
      {isMapReady && (
        <>
          <EcostressCompositeOverlay 
            visible={activeLayers.includes('ecostress')}
            regionBbox={selectedRegion?.bbox}
            allGranules={[]} 
          />
          <GlobalLSTOverlay visible={activeLayers.includes('global_lst')} />
        </>
      )}

      {/* LAYER C: UI Tools (Overlays) */}
      <div className="absolute top-0 left-0 z-20 h-full p-4 pointer-events-none">
        <div className="pointer-events-auto h-full max-w-md shadow-2xl">
           <RegionSidebar />
        </div>
      </div>

      <div className="absolute top-4 right-4 z-20 pointer-events-none">
        <div className="pointer-events-auto">
          <LayersControl />
        </div>
      </div>

      <div className="absolute bottom-10 right-14 z-20 pointer-events-auto">
         <OverlayDiagnosticsPanel />
      </div>

    </div>
  );
}
