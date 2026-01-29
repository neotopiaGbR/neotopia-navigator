import { useEffect, useState, useRef, useCallback } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { getKostraPmtilesUrl, KOSTRA_COLOR_SCALE, type KostraDuration, type KostraReturnPeriod } from './RiskLayersConfig';
import { toast } from '@/hooks/use-toast';
import * as pmtiles from 'pmtiles';

interface KostraLayerProps {
  visible: boolean;
  opacity?: number;
  duration: KostraDuration;
  returnPeriod: KostraReturnPeriod;
}

const LAYER_ID = 'kostra-precipitation';

// Ensure PMTiles protocol is registered globally
let protocolRegistered = false;

function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  
  const protocol = new pmtiles.Protocol();
  // Register for use with MVTLayer
  (globalThis as any).pmtilesProtocol = protocol;
  protocolRegistered = true;
  console.log('[KostraLayer] PMTiles protocol registered');
}

/**
 * Color mapping function for KOSTRA precipitation values (HN in mm)
 * Returns RGBA array for deck.gl styling
 * 
 * Scale for D60 (1-hour events):
 * - < 20mm: Light blue (low intensity)
 * - 20-30mm: Blue (moderate)
 * - 30-40mm: Purple-blue (significant)
 * - 40-50mm: Purple (high)
 * - > 50mm: Dark purple (extreme)
 */
function precipitationToRGBA(hn: number, opacity: number = 0.6): [number, number, number, number] {
  // NoData or invalid values
  if (hn == null || hn < 0 || !isFinite(hn)) {
    return [0, 0, 0, 0];
  }

  const alpha = Math.round(opacity * 255);
  
  // Color stops for precipitation intensity
  if (hn < 15) {
    // Very light - almost transparent light blue
    return [224, 243, 255, Math.round(alpha * 0.3)];
  } else if (hn < 20) {
    // Light blue
    return [166, 212, 255, alpha];
  } else if (hn < 30) {
    // Blue
    return [107, 179, 255, alpha];
  } else if (hn < 40) {
    // Medium blue
    return [61, 139, 255, alpha];
  } else if (hn < 50) {
    // Purple-blue
    return [33, 102, 204, alpha];
  } else if (hn < 70) {
    // Purple
    return [92, 61, 153, alpha];
  } else {
    // Dark purple (extreme)
    return [139, 26, 139, alpha];
  }
}

/**
 * KostraLayer Component - PMTiles Vector Edition
 * 
 * Renders KOSTRA-DWD-2020 precipitation intensity data using deck.gl MVTLayer.
 * Loads only visible tiles via HTTP Range Requests on PMTiles archive.
 * 
 * Benefits:
 * - Browser downloads only visible vector tiles
 * - Efficient zoom-level rendering via internal tile pyramid
 * - No tile server required - works with static hosting
 * - Vector data allows precise styling based on HN attribute
 */
export default function KostraLayer({
  visible,
  opacity = 0.7,
  duration,
  returnPeriod,
}: KostraLayerProps) {
  const [error, setError] = useState<string | null>(null);
  const [pmtilesUrl, setPmtilesUrl] = useState<string>('');
  
  const prevScenarioRef = useRef<string>('');

  // Create scenario key to detect changes
  const scenarioKey = `${duration}-${returnPeriod}`;

  // Ensure protocol is registered on mount
  useEffect(() => {
    ensurePmtilesProtocol();
  }, []);

  // Update PMTiles URL when scenario changes
  useEffect(() => {
    if (!visible) {
      removeLayer(LAYER_ID);
      return;
    }

    const newUrl = getKostraPmtilesUrl(duration, returnPeriod);
    setPmtilesUrl(newUrl);
    
    // Verify PMTiles is accessible when scenario changes
    if (scenarioKey !== prevScenarioRef.current) {
      prevScenarioRef.current = scenarioKey;
      verifyPmtiles(newUrl);
    }
  }, [visible, scenarioKey, duration, returnPeriod]);

  const verifyPmtiles = useCallback(async (url: string) => {
    setError(null);
    
    try {
      // Quick HEAD request to verify PMTiles exists
      const response = await fetch(url, { method: 'HEAD' });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`KOSTRA-Daten für ${duration}/${returnPeriod} nicht verfügbar`);
        }
        throw new Error(`HTTP ${response.status}`);
      }
      
      console.log(`[KostraLayer] PMTiles verified: ${url}`);
      
    } catch (err) {
      console.error('[KostraLayer] PMTiles verification failed:', err);
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      
      toast({
        title: 'KOSTRA-Daten nicht verfügbar',
        description: err instanceof Error ? err.message : 'Laden fehlgeschlagen',
        variant: 'destructive',
      });
    }
  }, [duration, returnPeriod]);

  // Register MVTLayer with DeckOverlayManager
  useEffect(() => {
    if (!visible || !pmtilesUrl) {
      removeLayer(LAYER_ID);
      return;
    }

    console.log('[KostraLayer] Registering MVTLayer for PMTiles:', pmtilesUrl);

    // Create MVTLayer configuration for PMTiles
    updateLayer({
      id: LAYER_ID,
      type: 'mvt',
      visible: true,
      opacity,
      // PMTiles URL - the DeckOverlayManager will handle the protocol
      data: `pmtiles://${pmtilesUrl}`,
      // Styling configuration
      styleConfig: {
        getFillColor: (f: any) => {
          const hn = f.properties?.HN ?? f.properties?.hn ?? 0;
          return precipitationToRGBA(hn, 0.6);
        },
        getLineColor: [100, 100, 120, 80],
        getLineWidth: 0.5,
        lineWidthMinPixels: 0.5,
        filled: true,
        stroked: true,
        pickable: true,
      },
      // Tile settings
      minZoom: 4,
      maxZoom: 14,
    } as any);
    
  }, [visible, pmtilesUrl, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeLayer(LAYER_ID);
    };
  }, []);

  return null;
}
