// src/components/map/RegionMap.tsx
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import Map, { NavigationControl, ScaleControl, AttributionControl, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapOverlays } from '@/hooks/useMapOverlays';
import { useRegion } from '@/contexts/RegionContext';
import { useDwdTemperature } from '@/hooks/useDwdTemperature';
import { useMapLayers } from './MapLayersContext';
import { initDeckOverlay, finalizeDeckOverlay } from './DeckOverlayManager';
import { MAP_STYLES } from './basemapStyles';

// Overlays Imports
import AirTemperatureOverlay from './AirTemperatureOverlay';
import AirTemperatureLegend from './AirTemperatureLegend';
import EcostressCompositeOverlay from './ecostress/EcostressCompositeOverlay';
import { GlobalLSTOverlay } from './GlobalLSTOverlay';
import LayersControl from './LayersControl';
import OverlayDiagnosticsPanel from './OverlayDiagnosticsPanel';
import HeatLayerProvenancePanel from './HeatLayerProvenancePanel';

export default function RegionMap() {
  const mapRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const { 
    regions,
    selectedRegion,
    selectedRegionId,
    setSelectedRegionId,
    hoveredRegionId,
    setHoveredRegionId,
  } = useRegion();

  const { activeLayers, mapStyle, ecostressMetadata } = useMapOverlays();
  const { heatLayers, airTemperature } = useMapLayers();
  const { data: tempData } = useDwdTemperature();
  const [isMapReady, setIsMapReady] = useState(false);

  // Sicherer Style-Zugriff
  // @ts-ignore
  const currentStyle = MAP_STYLES[mapStyle] || MAP_STYLES.LIGHT;

  const onMapLoad = useCallback((e: any) => {
    console.log('Map loaded');
    try {
      mapInstanceRef.current = e.target;
      initDeckOverlay(e.target);
      setIsMapReady(true);
    } catch (err) {
      console.error('Deck init failed:', err);
    }
  }, []);

  const regionsGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: regions.map((r) => ({
        type: 'Feature' as const,
        geometry: r.geom as any,
        properties: {
          id: r.id,
          name: r.name,
        },
      })),
    };
  }, [regions]);

  const onMouseMove = useCallback((e: any) => {
    const feature = e?.features?.[0];
    const id = (feature?.properties?.id as string | undefined) ?? null;
    setHoveredRegionId(id);
    try {
      e?.target?.getCanvas?.().style && (e.target.getCanvas().style.cursor = id ? 'pointer' : '');
    } catch {
      // ignore
    }
  }, [setHoveredRegionId]);

  const onClick = useCallback((e: any) => {
    const feature = e?.features?.[0];
    const id = (feature?.properties?.id as string | undefined) ?? null;
    if (!id) return;
    setSelectedRegionId(id === selectedRegionId ? null : id);
  }, [selectedRegionId, setSelectedRegionId]);

  // Cleanup
  useEffect(() => {
    return () => {
      try { finalizeDeckOverlay(); } catch (e) { console.error(e); }
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-background">
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
        onMouseMove={onMouseMove}
        onClick={onClick}
        interactiveLayerIds={regions.length > 0 ? ['regions-fill'] : []}
        attributionControl={false}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" />
        <AttributionControl customAttribution="Neotopia" position="bottom-right" />

        {/* Regions (GeoJSON from RegionContext) */}
        {regions.length > 0 && (
          <Source id="regions-source" type="geojson" data={regionsGeoJson as any}>
            <Layer
              id="regions-fill"
              type="fill"
              paint={{
                'fill-color': '#00ff00',
                'fill-opacity': 0.06,
              }}
            />
            <Layer
              id="regions-hover"
              type="fill"
              filter={hoveredRegionId ? ['==', ['get', 'id'], hoveredRegionId] : ['==', ['get', 'id'], '__none__']}
              paint={{
                'fill-color': '#00ff00',
                'fill-opacity': 0.14,
              }}
            />
            <Layer
              id="regions-selected"
              type="fill"
              filter={selectedRegionId ? ['==', ['get', 'id'], selectedRegionId] : ['==', ['get', 'id'], '__none__']}
              paint={{
                'fill-color': '#00ff00',
                'fill-opacity': 0.22,
              }}
            />
            <Layer
              id="regions-outline"
              type="line"
              paint={{
                'line-color': '#00ff00',
                'line-width': 1.5,
                'line-opacity': 0.9,
              }}
            />
          </Source>
        )}

        {/* Layer 1: Air Temp */}
        <AirTemperatureOverlay 
          visible={activeLayers.includes('air_temperature')}
          data={tempData?.grid}
          opacity={airTemperature.opacity / 100}
        />

        {/* Layer 2: Deck GL (Composite) */}
        {isMapReady && (
          <>
            <EcostressCompositeOverlay 
              map={mapRef.current?.getMap()}
              visible={activeLayers.includes('ecostress')}
              regionBbox={((ecostressMetadata as any)?.regionBbox as any) ?? selectedRegion?.bbox}
              allGranules={((ecostressMetadata as any)?.allGranules as any[]) ?? []}
              opacity={heatLayers.ecostressOpacity / 100}
            />
            <GlobalLSTOverlay 
              map={mapInstanceRef.current ?? null}
              visible={activeLayers.includes('global_lst')}
              opacity={heatLayers.globalLSTOpacity / 100}
            />
          </>
        )}
      </Map>

      {/* Map UI */}
      <LayersControl />
      <OverlayDiagnosticsPanel visible={import.meta.env.DEV} mapRef={mapInstanceRef} />

      {/* Legends - Top Right */}
      <div className="absolute top-14 right-3 z-10 flex flex-col gap-2">
        {/* Air Temperature Legend */}
        {activeLayers.includes('air_temperature') && tempData?.normalization && (
          <AirTemperatureLegend 
            min={tempData.normalization.p5 ?? tempData.normalization.min ?? 10}
            max={tempData.normalization.p95 ?? tempData.normalization.max ?? 35}
          />
        )}

        {/* ECOSTRESS/Heat Provenance Panel */}
        {(activeLayers.includes('ecostress') || activeLayers.includes('global_lst')) && (
          <HeatLayerProvenancePanel
            visible={true}
            ecostressEnabled={activeLayers.includes('ecostress')}
            ecostressMetadata={ecostressMetadata as any}
            ecostressLoading={false}
            globalLSTOpacity={heatLayers.globalLSTOpacity}
            ecostressOpacity={heatLayers.ecostressOpacity}
            aggregationMethod={heatLayers.aggregationMethod as any}
          />
        )}
      </div>
    </div>
  );
}
