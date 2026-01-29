import { useEffect, useState, useRef, useCallback } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { getCatrareGeoJsonUrl, CATRARE_WARNING_COLORS, type CatrareEventProperties } from './RiskLayersConfig';
import { toast } from '@/hooks/use-toast';

interface CatrareLayerProps {
  visible: boolean;
  opacity?: number;
  onEventHover?: (event: CatrareEventProperties | null) => void;
}

const LAYER_ID = 'catrare-events';

/**
 * CatrareLayer Component
 * 
 * Renders historical heavy rainfall events from CatRaRE as polygon overlays.
 * Uses deck.gl GeoJsonLayer via DeckOverlayManager singleton.
 * 
 * NOTE: This component stores GeoJSON data and registers it with the overlay manager.
 * The actual GeoJsonLayer rendering is handled by extending DeckOverlayManager.
 */
export default function CatrareLayer({
  visible,
  opacity = 0.6,
  onEventHover,
}: CatrareLayerProps) {
  const [geoJsonData, setGeoJsonData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const loadIdRef = useRef(0);
  const hasLoadedRef = useRef(false);

  // Load GeoJSON data once
  useEffect(() => {
    if (!visible) {
      removeLayer(LAYER_ID);
      return;
    }

    // Skip if already loaded
    if (hasLoadedRef.current && geoJsonData) {
      return;
    }

    loadGeoJson();
  }, [visible]);

  const loadGeoJson = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setIsLoading(true);
    setError(null);
    
    const url = getCatrareGeoJsonUrl();
    console.log(`[CatrareLayer] Loading GeoJSON: ${url}`);

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('CatRaRE-Daten noch nicht verfügbar. Bitte laden Sie die Daten hoch.');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as GeoJSON.FeatureCollection;
      
      // Check if this load is still current
      if (loadId !== loadIdRef.current) {
        console.log('[CatrareLayer] Load superseded, discarding');
        return;
      }

      console.log(`[CatrareLayer] Loaded ${data.features?.length || 0} events`);
      
      hasLoadedRef.current = true;
      setGeoJsonData(data);
      setIsLoading(false);
      setError(null);

    } catch (err) {
      console.error('[CatrareLayer] Load error:', err);
      
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(message);
      setIsLoading(false);
      
      toast({
        title: 'CatRaRE-Daten nicht verfügbar',
        description: message,
        variant: 'destructive',
      });
    }
  }, []);

  // Register layer with DeckOverlayManager when data changes
  useEffect(() => {
    if (!visible || !geoJsonData) {
      removeLayer(LAYER_ID);
      return;
    }

    console.log('[CatrareLayer] Registering GeoJson layer');

    // For GeoJsonLayer, we pass the data directly
    // DeckOverlayManager needs to be extended to handle 'geojson' type
    updateLayer({
      id: LAYER_ID,
      type: 'geojson' as any, // Type extension needed in DeckOverlayManager
      visible: true,
      opacity,
      data: geoJsonData,
      // Style configuration passed via data property
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
  }, [visible, geoJsonData, opacity]);

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
