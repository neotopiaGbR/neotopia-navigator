import { useEffect, useState, useRef, useCallback } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { getCatrarePmtilesUrl, getCatrareGeoJsonUrl, CATRARE_WARNING_COLORS, type CatrareEventProperties } from './RiskLayersConfig';
import { toast } from '@/hooks/use-toast';
import { PMTiles, Protocol } from 'pmtiles';

interface CatrareLayerProps {
  visible: boolean;
  opacity?: number;
  onEventHover?: (event: CatrareEventProperties | null) => void;
}

const LAYER_ID = 'catrare-events';

// PMTiles protocol singleton
let pmtilesProtocol: Protocol | null = null;

/**
 * Initialize PMTiles protocol for MapLibre/deck.gl integration.
 * This enables the pmtiles:// URL scheme.
 */
function initPmtilesProtocol(): Protocol {
  if (!pmtilesProtocol) {
    pmtilesProtocol = new Protocol();
    console.log('[CatrareLayer] PMTiles protocol initialized');
  }
  return pmtilesProtocol;
}

/**
 * CatrareLayer Component - PMTiles Edition
 * 
 * Renders historical heavy rainfall events from CatRaRE using deck.gl MVTLayer.
 * Loads vector tiles on-demand via HTTP Range Requests from a PMTiles archive.
 * 
 * Benefits:
 * - Single file contains all zoom levels (z4-z12)
 * - Browser downloads only visible tiles
 * - No tile server required - works with static hosting
 * 
 * Fallback: If PMTiles fails, loads full GeoJSON.
 */
export default function CatrareLayer({
  visible,
  opacity = 0.6,
  onEventHover,
}: CatrareLayerProps) {
  const [dataSource, setDataSource] = useState<'pmtiles' | 'geojson' | null>(null);
  const [geoJsonData, setGeoJsonData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [pmtilesUrl, setPmtilesUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const loadIdRef = useRef(0);
  const hasAttemptedRef = useRef(false);

  // Initialize data source when visible
  useEffect(() => {
    if (!visible) {
      removeLayer(LAYER_ID);
      return;
    }

    if (hasAttemptedRef.current && (dataSource === 'pmtiles' || geoJsonData)) {
      return; // Already loaded
    }

    initDataSource();
  }, [visible]);

  const initDataSource = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setIsLoading(true);
    setError(null);
    hasAttemptedRef.current = true;

    const pmtilesFullUrl = getCatrarePmtilesUrl();
    console.log(`[CatrareLayer] Trying PMTiles: ${pmtilesFullUrl}`);

    try {
      // Try PMTiles first
      const response = await fetch(pmtilesFullUrl, { method: 'HEAD' });
      
      if (response.ok) {
        // Verify it's a valid PMTiles by checking header
        const pmtiles = new PMTiles(pmtilesFullUrl);
        const header = await pmtiles.getHeader();
        
        if (loadId !== loadIdRef.current) return;
        
        console.log(`[CatrareLayer] PMTiles valid: z${header.minZoom}-${header.maxZoom}, ${header.numAddressedTiles} tiles`);
        
        // Initialize protocol
        initPmtilesProtocol();
        
        setPmtilesUrl(pmtilesFullUrl);
        setDataSource('pmtiles');
        setIsLoading(false);
        return;
      }
    } catch (err) {
      console.warn('[CatrareLayer] PMTiles not available, falling back to GeoJSON:', err);
    }

    // Fallback to GeoJSON
    try {
      const geojsonUrl = getCatrareGeoJsonUrl();
      console.log(`[CatrareLayer] Falling back to GeoJSON: ${geojsonUrl}`);
      
      const response = await fetch(geojsonUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as GeoJSON.FeatureCollection;
      
      if (loadId !== loadIdRef.current) return;

      console.log(`[CatrareLayer] Loaded ${data.features?.length || 0} events from GeoJSON`);
      
      setGeoJsonData(data);
      setDataSource('geojson');
      setIsLoading(false);

    } catch (err) {
      console.error('[CatrareLayer] Both PMTiles and GeoJSON failed:', err);
      
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(message);
      setIsLoading(false);
      
      toast({
        title: 'CatRaRE-Daten nicht verfügbar',
        description: 'Weder PMTiles noch GeoJSON konnten geladen werden.',
        variant: 'destructive',
      });
    }
  }, []);

  // Register layer based on data source
  useEffect(() => {
    if (!visible || !dataSource) {
      removeLayer(LAYER_ID);
      return;
    }

    if (dataSource === 'pmtiles' && pmtilesUrl) {
      console.log('[CatrareLayer] Registering MVTLayer for PMTiles');
      
      updateLayer({
        id: LAYER_ID,
        type: 'mvt',
        visible: true,
        opacity,
        pmtilesUrl,
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
      
    } else if (dataSource === 'geojson' && geoJsonData) {
      console.log('[CatrareLayer] Registering GeoJsonLayer (fallback)');
      
      updateLayer({
        id: LAYER_ID,
        type: 'geojson',
        visible: true,
        opacity,
        data: geoJsonData,
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
    }
  }, [visible, dataSource, pmtilesUrl, geoJsonData, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeLayer(LAYER_ID);
    };
  }, []);

  return null;
}

// Helper to convert hex to RGBA array for deck.gl
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
