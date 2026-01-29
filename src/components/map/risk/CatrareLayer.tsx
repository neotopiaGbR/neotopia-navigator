import { useEffect, useRef, useCallback } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { getCatrarePmtilesUrl, getCatrareGeoJsonUrl, CATRARE_WARNING_COLORS, type CatrareEventProperties } from './RiskLayersConfig';
import { toast } from '@/hooks/use-toast';
import { PMTiles } from 'pmtiles';
import { devLog } from '@/lib/geoUtils';

interface CatrareLayerProps {
  visible: boolean;
  opacity?: number;
  onEventHover?: (event: CatrareEventProperties | null) => void;
}

const LAYER_ID = 'catrare-events';

/**
 * Convert hex color to RGBA array for deck.gl
 */
function hexToRGBA(hex: string, alpha: number): [number, number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0, Math.round(alpha * 255)];

  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
    Math.round(alpha * 255),
  ];
}

/**
 * CatrareLayer Component - PMTiles Edition
 *
 * Renders historical heavy rainfall events from CatRaRE using deck.gl MVTLayer.
 * Loads vector tiles on-demand via HTTP Range Requests from a PMTiles archive.
 *
 * Fallback: If PMTiles fails, loads full GeoJSON.
 */
export default function CatrareLayer({
  visible,
  opacity = 0.6,
  onEventHover,
}: CatrareLayerProps) {
  const dataSourceRef = useRef<'pmtiles' | 'geojson' | null>(null);
  const geoJsonDataRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const pmtilesUrlRef = useRef<string>('');
  const isLoadingRef = useRef(false);
  const loadIdRef = useRef(0);
  const hasAttemptedRef = useRef(false);

  // Initialize data source when visible
  useEffect(() => {
    if (!visible) {
      removeLayer(LAYER_ID);
      return;
    }

    if (hasAttemptedRef.current && (dataSourceRef.current === 'pmtiles' || geoJsonDataRef.current)) {
      return; // Already loaded
    }

    initDataSource();
  }, [visible]);

  const initDataSource = useCallback(async () => {
    if (isLoadingRef.current) return;
    
    const loadId = ++loadIdRef.current;
    isLoadingRef.current = true;
    hasAttemptedRef.current = true;

    const pmtilesFullUrl = getCatrarePmtilesUrl();
    devLog('CatrareLayer', `Loading PMTiles: ${pmtilesFullUrl}`);

    try {
      // Validate PMTiles file
      const pmtiles = new PMTiles(pmtilesFullUrl);
      const header = await pmtiles.getHeader();

      if (loadId !== loadIdRef.current) return;

      devLog('CatrareLayer', `PMTiles valid: z${header.minZoom}-${header.maxZoom}, ${header.numAddressedTiles} tiles`);

      pmtilesUrlRef.current = pmtilesFullUrl;
      dataSourceRef.current = 'pmtiles';
      isLoadingRef.current = false;
      
      // Register the layer
      registerPmtilesLayer(pmtilesFullUrl, opacity);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[CatrareLayer] PMTiles not available, falling back to GeoJSON:', err);
      }

      // Fallback to GeoJSON
      try {
        const geojsonUrl = getCatrareGeoJsonUrl();
        devLog('CatrareLayer', `Falling back to GeoJSON: ${geojsonUrl}`);

        const response = await fetch(geojsonUrl);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as GeoJSON.FeatureCollection;

        if (loadId !== loadIdRef.current) return;

        devLog('CatrareLayer', `Loaded ${data.features?.length || 0} events from GeoJSON`);

        geoJsonDataRef.current = data;
        dataSourceRef.current = 'geojson';
        isLoadingRef.current = false;
        
        // Register the layer
        registerGeoJsonLayer(data, opacity);
      } catch (fallbackErr) {
        if (import.meta.env.DEV) {
          console.error('[CatrareLayer] Both PMTiles and GeoJSON failed:', fallbackErr);
        }

        isLoadingRef.current = false;

        toast({
          title: 'CatRaRE-Daten nicht verfügbar',
          description: 'Weder PMTiles noch GeoJSON konnten geladen werden.',
          variant: 'destructive',
        });
      }
    }
  }, [opacity]);

  // Register PMTiles layer
  const registerPmtilesLayer = useCallback((url: string, layerOpacity: number) => {
    devLog('CatrareLayer', 'Registering MVTLayer for PMTiles');

    updateLayer({
      id: LAYER_ID,
      type: 'mvt',
      visible: true,
      opacity: layerOpacity,
      pmtilesUrl: url,
      layerName: 'catrare',
      styleConfig: {
        getFillColor: (feature: any) => {
          const warningLevel = feature.properties?.WARNSTUFE || 3;
          const hex = CATRARE_WARNING_COLORS[warningLevel as keyof typeof CATRARE_WARNING_COLORS] || CATRARE_WARNING_COLORS[3];
          return hexToRGBA(hex, 0.4);
        },
        getLineColor: (feature: any) => {
          const warningLevel = feature.properties?.WARNSTUFE || 3;
          const hex = CATRARE_WARNING_COLORS[warningLevel as keyof typeof CATRARE_WARNING_COLORS] || CATRARE_WARNING_COLORS[3];
          return hexToRGBA(hex, 1);
        },
        lineWidth: 2,
        pickable: true,
      },
    } as any);
  }, []);

  // Register GeoJSON layer
  const registerGeoJsonLayer = useCallback((data: GeoJSON.FeatureCollection, layerOpacity: number) => {
    devLog('CatrareLayer', 'Registering GeoJsonLayer (fallback)');

    updateLayer({
      id: LAYER_ID,
      type: 'geojson',
      visible: true,
      opacity: layerOpacity,
      data: data,
      styleConfig: {
        getFillColor: (feature: GeoJSON.Feature) => {
          const props = feature.properties as CatrareEventProperties;
          const warningLevel = props?.WARNSTUFE || 3;
          const hex = CATRARE_WARNING_COLORS[warningLevel as keyof typeof CATRARE_WARNING_COLORS] || CATRARE_WARNING_COLORS[3];
          return hexToRGBA(hex, 0.4);
        },
        getLineColor: (feature: GeoJSON.Feature) => {
          const props = feature.properties as CatrareEventProperties;
          const warningLevel = props?.WARNSTUFE || 3;
          const hex = CATRARE_WARNING_COLORS[warningLevel as keyof typeof CATRARE_WARNING_COLORS] || CATRARE_WARNING_COLORS[3];
          return hexToRGBA(hex, 1);
        },
        lineWidth: 2,
        pickable: true,
      },
    } as any);
  }, []);

  // Update layer when opacity changes
  useEffect(() => {
    if (!visible || !dataSourceRef.current) return;
    
    if (dataSourceRef.current === 'pmtiles' && pmtilesUrlRef.current) {
      registerPmtilesLayer(pmtilesUrlRef.current, opacity);
    } else if (dataSourceRef.current === 'geojson' && geoJsonDataRef.current) {
      registerGeoJsonLayer(geoJsonDataRef.current, opacity);
    }
  }, [visible, opacity, registerPmtilesLayer, registerGeoJsonLayer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeLayer(LAYER_ID);
    };
  }, []);

  return null;
}
