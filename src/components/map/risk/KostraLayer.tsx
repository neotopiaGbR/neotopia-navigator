import { useEffect, useState, useRef, useCallback } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { getKostraPmtilesUrl, type KostraDuration, type KostraReturnPeriod } from './RiskLayersConfig';
import { toast } from '@/hooks/use-toast';
import { PMTiles } from 'pmtiles';

interface KostraLayerProps {
  visible: boolean;
  opacity?: number;
  duration: KostraDuration;
  returnPeriod: KostraReturnPeriod;
}

const LAYER_ID = 'kostra-precipitation';

// Track if we've logged properties (for debugging)
let hasLoggedProps = false;

/**
 * Convert precipitation value (HN in mm) to RGBA color.
 * Uses the KOSTRA color scale for consistent styling.
 */
function precipitationToRGBA(hn: number, opacity: number = 0.6): [number, number, number, number] {
  const alpha = Math.round(opacity * 255);

  if (hn < 15) return [224, 243, 255, alpha];      // Very light blue
  if (hn < 20) return [166, 212, 255, alpha];      // Light blue
  if (hn < 30) return [107, 179, 255, alpha];      // Medium blue
  if (hn < 40) return [61, 139, 255, alpha];       // Blue
  if (hn < 50) return [33, 102, 204, alpha];       // Dark blue
  if (hn < 60) return [92, 61, 153, alpha];        // Purple
  if (hn < 70) return [139, 26, 139, alpha];       // Dark purple
  return [102, 0, 102, alpha];                      // Very dark purple
}

/**
 * KostraLayer Component - PMTiles Vector Edition
 *
 * Renders KOSTRA-DWD-2020 precipitation data as vector tiles.
 * Loads vector tiles on-demand via HTTP Range Requests from a PMTiles archive.
 */
export default function KostraLayer({
  visible,
  opacity = 0.7,
  duration,
  returnPeriod,
}: KostraLayerProps) {
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

    if (hasAttemptedRef.current && pmtilesUrl) {
      return; // Already loaded
    }

    initDataSource();
  }, [visible, duration, returnPeriod]);

  const initDataSource = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setIsLoading(true);
    setError(null);
    hasAttemptedRef.current = true;

    const url = getKostraPmtilesUrl(duration, returnPeriod);
    console.log(`[KostraLayer] Loading PMTiles: ${url}`);

    try {
      // Validate PMTiles file
      const pmtiles = new PMTiles(url);
      const header = await pmtiles.getHeader();

      if (loadId !== loadIdRef.current) return;

      console.log(`[KostraLayer] PMTiles valid: z${header.minZoom}-${header.maxZoom}, ${header.numAddressedTiles} tiles`);

      setPmtilesUrl(url);
      setIsLoading(false);
    } catch (err) {
      console.error('[KostraLayer] Failed to load PMTiles:', err);

      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(message);
      setIsLoading(false);

      toast({
        title: 'KOSTRA-Daten nicht verfügbar',
        description: 'PMTiles konnten nicht geladen werden.',
        variant: 'destructive',
      });
    }
  }, [duration, returnPeriod]);

  // Register layer when URL is available
  useEffect(() => {
    if (!visible || !pmtilesUrl) {
      removeLayer(LAYER_ID);
      return;
    }

    console.log('[KostraLayer] Registering MVTLayer for PMTiles');

    updateLayer({
      id: LAYER_ID,
      type: 'mvt',
      visible: true,
      opacity,
      pmtilesUrl,
      layerName: 'kostra',
      styleConfig: {
        getFillColor: (feature: any) => {
          const props = feature.properties || {};

          // Debug: Log available properties for first feature
          if (!hasLoggedProps) {
            console.log('[KostraLayer] Feature properties:', Object.keys(props));
            hasLoggedProps = true;
          }

          // Try different possible attribute names for precipitation height
          const hn = props.HN_100A ?? props.HN_0100A ?? props.HN ?? props.hn ?? 0;
          return precipitationToRGBA(hn, 0.6);
        },
        getLineColor: [100, 100, 100, 80],
        lineWidth: 0.5,
        pickable: true,
      },
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
