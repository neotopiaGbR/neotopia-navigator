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
  
  // Data
  const { data: tempData } = useDwdTemperature();
  
  const [isMapReady, setIsMapReady] = useState(false);

  // Style URL sicher auflösen
  // @ts-ignore
  const styleUrl = MAP_STYLES[mapStyle] || MAP_STYLES.LIGHT || MAP_STYLES.light;

  // Init Deck.gl
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

  useEffect(() => {
    return () => finalizeDeckOverlay();
  }, []);

  return (
    <div className="relative w-full h-full bg-slate-100 overflow-hidden">
      {/* 1. Die Karte (Hintergrund) */}
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

        {/* --- Native MapLibre Layers (MÜSSEN in <Map> bleiben) --- */}
        <AirTemperatureOverlay 
          visible={activeLayers.includes('air_temperature')}
          data={tempData?.grid}
        />
        
        {/* HIER WAREN DIE DECK.GL LAYER - JETZT SIND SIE UNTEN */}
      </Map>

      {/* --- Logik-Layer (Deck.gl) --- 
          FIX: Außerhalb von <Map> platzieren, um Ref-Fehler zu vermeiden.
          Sie funktionieren trotzdem, da sie über den Singleton/Manager auf die Karte zugreifen. 
      */}
      {isMapReady && mapRef.current && (
        <>
          <EcostressCompositeOverlay 
            // Wir übergeben die Map-Instanz explizit, falls benötigt
            map={mapRef.current.getMap()}
            visible={activeLayers.includes('ecostress')}
            regionBbox={selectedRegion?.bbox}
            allGranules={[]} // Leeres Array, damit es sich Daten selbst holt (siehe vorherigen Fix)
          />
          <GlobalLSTOverlay visible={activeLayers.includes('global_lst')} />
        </>
      )}

      {/* 2. Die UI Tools (Absolute Positionierung über der Karte) */}
      
      {/* Sidebar Links */}
      <div className="absolute top-0 left-0 z-20 h-full p-4 pointer-events-none">
        <div className="pointer-events-auto h-full max-w-md shadow-2xl">
           <RegionSidebar />
        </div>
      </div>

      {/* Layer Control Rechts Oben */}
      <div className="absolute top-4 right-4 z-20 pointer-events-none">
        <div className="pointer-events-auto">
          <LayersControl />
        </div>
      </div>

      {/* Diagnose Panel Unten Rechts */}
      <div className="absolute bottom-10 right-14 z-20 pointer-events-auto">
         <OverlayDiagnosticsPanel />
      </div>

    </div>
  );
}
