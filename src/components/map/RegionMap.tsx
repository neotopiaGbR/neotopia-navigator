import { useRef, useEffect, useState, useCallback } from 'react';
import Map, { NavigationControl, ScaleControl, AttributionControl, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapOverlays } from '@/hooks/useMapOverlays';
import { useRegion } from '@/contexts/RegionContext';
import { useDwdTemperature } from '@/hooks/useDwdTemperature';
import { initDeckOverlay, finalizeDeckOverlay } from './DeckOverlayManager';
import { MAP_STYLES } from './basemapStyles';

// Imports
import AirTemperatureOverlay from './AirTemperatureOverlay';
// WICHTIG: Named Import (in geschweiften Klammern), da wir "export default" entfernt haben
import { EcostressCompositeOverlay } from './ecostress/EcostressCompositeOverlay';
import GlobalLSTOverlay from './GlobalLSTOverlay';

import RegionSidebar from './RegionSidebar';
import LayersControl from './LayersControl';
import OverlayDiagnosticsPanel from './OverlayDiagnosticsPanel';

export default function RegionMap() {
  const mapRef = useRef<MapRef>(null);
  const { selectedRegion } = useRegion();
  const { activeLayers, mapStyle } = useMapOverlays();
  const { data: tempData } = useDwdTemperature();
  
  const [isMapReady, setIsMapReady] = useState(false);

  // @ts-ignore
  const styleUrl = MAP_STYLES[mapStyle] || MAP_STYLES.LIGHT || MAP_STYLES.light;

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
        attributionControl={false}
        reuseMaps
      >
        <AttributionControl customAttribution="Neotopia Navigator" position="bottom-right" />
        <NavigationControl position="top-right" style={{ marginRight: '50px' }} />
        <ScaleControl position="bottom-left" />

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

      {/* UI TOOLS */}
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
         <OverlayDiagnosticsPanel visible={true} mapRef={mapRef} />
      </div>

    </div>
  );
}
