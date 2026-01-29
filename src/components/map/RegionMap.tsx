import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import Map, { NavigationControl, ScaleControl, AttributionControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection, Feature, Geometry } from 'geojson';

import { useMapOverlays } from '@/hooks/useMapOverlays';
import { useMapLayers } from './MapLayersContext';
import { useRegion } from '@/contexts/RegionContext';
import { useDwdTemperature } from '@/hooks/useDwdTemperature';
import { useDwdMonthlyTemperature } from '@/hooks/useDwdMonthlyTemperature';
import { initDeckOverlay, finalizeDeckOverlay } from './DeckOverlayManager';
import { MAP_STYLES } from './basemapStyles';

import AirTemperatureOverlay from './AirTemperatureOverlay';
import AirTemperatureLegend from './AirTemperatureLegend';
import HeatLegend from './HeatLegend';
import { EcostressCompositeOverlay } from './ecostress/EcostressCompositeOverlay';
import GlobalLSTOverlay from './GlobalLSTOverlay';

import LayersControl from './LayersControl';
import OverlayDiagnosticsPanel from './OverlayDiagnosticsPanel';

// Accent color for regions (green)
const ACCENT_COLOR = '#22c55e';
const ACCENT_COLOR_SELECTED = '#16a34a';
const ACCENT_COLOR_HOVER = 'rgba(34, 197, 94, 0.6)';
const ACCENT_COLOR_FILL = 'rgba(34, 197, 94, 0.2)';

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
  const { airTemperature, overlays, heatLayers } = useMapLayers();
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
  // Compute region center for monthly data fetch
  const regionCenter = useMemo(() => {
    if (!selectedRegion?.bbox) return null;
    const bbox = selectedRegion.bbox;
    return {
      lat: (bbox[1] + bbox[3]) / 2,
      lon: (bbox[0] + bbox[2]) / 2,
    };
  }, [selectedRegion?.bbox]);

  // Fetch monthly temperature data for selected region
  const monthlyData = useDwdMonthlyTemperature({
    lat: regionCenter?.lat ?? null,
    lon: regionCenter?.lon ?? null,
    year: tempData?.year ?? null,
    enabled: airTemperature.enabled && !!selectedRegion,
  });

  // Show legends when layers are active
  const showAirTempLegend = airTemperature.enabled && tempData?.normalization;
  const showHeatLegend = overlays.ecostress.enabled;
  const ecostressGranuleCount = (overlays.ecostress.metadata?.granuleCount as number) || 
    (overlays.ecostress.metadata?.allGranules as any[])?.length || 0;

  // Find temperature value for selected region (nearest grid cell)
  const regionTempValue = useMemo(() => {
    if (!selectedRegion || !tempData?.grid || tempData.grid.length === 0 || !regionCenter) return null;
    
    // Find nearest grid cell
    let nearest = tempData.grid[0];
    let minDist = Infinity;
    
    for (const cell of tempData.grid) {
      const dist = Math.pow(cell.lon - regionCenter.lon, 2) + Math.pow(cell.lat - regionCenter.lat, 2);
      if (dist < minDist) {
        minDist = dist;
        nearest = cell;
      }
    }
    
    return nearest?.value ?? null;
  }, [selectedRegion, tempData?.grid, regionCenter]);

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

        {/* Region Tiles with proper color values (not CSS variables) */}
        {regions.length > 0 && (
          <Source id="regions-source" type="geojson" data={regionsGeoJson}>
            {/* Fill Layer - transparent, only for click interaction */}
            <Layer
              id="regions-fill"
              type="fill"
              paint={{
                'fill-color': 'transparent',
                'fill-opacity': 0,
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
                  ACCENT_COLOR_SELECTED,
                  ACCENT_COLOR,
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
          cellSizeMeters={tempData?.cellsize_m ?? 3000}
        />
      </Map>

      {/* LOGIK-LAYER (Außerhalb der Map um Refs-Fehler zu vermeiden) */}
      {isMapReady && mapRef.current && (
        <>
          <EcostressCompositeOverlay 
            visible={activeLayers.includes('ecostress')}
            regionBbox={selectedRegion?.bbox}
            allGranules={(overlays.ecostress.metadata?.allGranules as any[]) ?? []}
            aggregationMethod={heatLayers.aggregationMethod}
            opacity={heatLayers.ecostressOpacity / 100}
          />
          <GlobalLSTOverlay 
            map={mapRef.current.getMap()} 
            visible={activeLayers.includes('global_lst')} 
          />
        </>
      )}

      {/* Legends (top-right, below nav controls) */}
      <div className="absolute top-16 right-3 z-20 space-y-2">
        {/* Heat Legend */}
        <HeatLegend 
          visible={showHeatLegend}
          aggregationMethod={heatLayers.aggregationMethod}
          granuleCount={ecostressGranuleCount}
        />

        {/* Air Temperature Legend */}
        <AirTemperatureLegend 
          visible={!!showAirTempLegend}
          aggregation={airTemperature.aggregation}
          normalization={tempData?.normalization}
          year={tempData?.year}
          regionValue={regionTempValue}
          regionName={selectedRegion?.name}
          monthlyValues={monthlyData.values}
          monthlyLoading={monthlyData.loading}
          monthlyYear={monthlyData.year}
          monthlyIsFallback={monthlyData.isFallback}
        />
      </div>

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
