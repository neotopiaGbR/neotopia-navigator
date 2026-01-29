import { useEffect, useState, useRef } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { decodeGranule, type DecodedGranule } from './decodeGranule';
import { supabase } from '@/integrations/supabase/client';

interface GranuleInput {
  cog_url: string;
  datetime: string;
  granule_id: string;
  granule_bounds?: [number, number, number, number];
}

interface Props {
  visible: boolean;
  opacity?: number;
  allGranules?: GranuleInput[];
  regionBbox?: [number, number, number, number];
}

const LAYER_PREFIX = 'ecostress-stack-';

/**
 * ECOSTRESS Stacked Overlay
 * 
 * Renders ALL granules as individual layers stacked on top of each other.
 * NO aggregation - raw data visualization.
 */
export default function EcostressStackedOverlay({
  visible,
  opacity = 0.6,
  allGranules = [],
  regionBbox,
}: Props) {
  const [decodedLayers, setDecodedLayers] = useState<DecodedGranule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchedGranules, setFetchedGranules] = useState<GranuleInput[]>([]);
  const prevBboxRef = useRef<string>('');
  const layerIdsRef = useRef<string[]>([]);

  const effectiveGranules = allGranules.length > 0 ? allGranules : fetchedGranules;
  const bboxKey = regionBbox ? regionBbox.join(',') : '';

  // Self-fetch granules if not provided
  useEffect(() => {
    if (!visible || !regionBbox || allGranules.length > 0) return;

    const fetchGranules = async () => {
      const centerLat = (regionBbox[1] + regionBbox[3]) / 2;
      const centerLon = (regionBbox[0] + regionBbox[2]) / 2;
      
      const now = new Date();
      const prevYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear();
      const dateFrom = `${prevYear}-06-01`;
      const dateTo = `${prevYear}-08-31`;

      console.log('[EcostressStacked] Fetching granules for summer', prevYear);

      try {
        const { data, error } = await supabase.functions.invoke('ecostress-latest-tile', {
          body: {
            lat: centerLat,
            lon: centerLon,
            region_bbox: regionBbox,
            date_from: dateFrom,
            date_to: dateTo,
            daytime_only: true,
          },
        });

        if (error) {
          console.error('[EcostressStacked] Fetch error:', error);
          return;
        }

        if (data?.status === 'match' && Array.isArray(data.all_granules)) {
          console.log(`[EcostressStacked] Found ${data.all_granules.length} granules`);
          setFetchedGranules(data.all_granules);
        }
      } catch (err) {
        console.error('[EcostressStacked] Fetch exception:', err);
      }
    };

    fetchGranules();
  }, [visible, regionBbox, allGranules.length]);

  // Decode all granules individually
  useEffect(() => {
    if (!visible || !regionBbox || effectiveGranules.length === 0) {
      // Cleanup existing layers
      layerIdsRef.current.forEach(id => removeLayer(id));
      layerIdsRef.current = [];
      setDecodedLayers([]);
      return;
    }

    if (bboxKey === prevBboxRef.current && decodedLayers.length > 0) {
      return; // Already decoded for this bbox
    }

    prevBboxRef.current = bboxKey;

    async function decodeAll() {
      setIsLoading(true);
      console.log(`[EcostressStacked] Decoding ${effectiveGranules.length} granules individually...`);

      // Cleanup old layers first
      layerIdsRef.current.forEach(id => removeLayer(id));
      layerIdsRef.current = [];

      const decoded: DecodedGranule[] = [];
      
      // Limit to first 20 granules to avoid overwhelming the GPU
      const maxGranules = Math.min(effectiveGranules.length, 20);
      
      for (let i = 0; i < maxGranules; i++) {
        const granule = effectiveGranules[i];
        try {
          const result = await decodeGranule(granule, regionBbox!);
          if (result) {
            decoded.push(result);
          }
        } catch (err) {
          console.warn(`[EcostressStacked] Failed to decode ${granule.granule_id}`);
        }
      }

      console.log(`[EcostressStacked] Successfully decoded ${decoded.length}/${maxGranules} granules`);
      setDecodedLayers(decoded);
      setIsLoading(false);
    }

    decodeAll();
  }, [visible, regionBbox, effectiveGranules, bboxKey]);

  // Update deck.gl layers when decoded layers change
  useEffect(() => {
    if (!visible || decodedLayers.length === 0) {
      layerIdsRef.current.forEach(id => removeLayer(id));
      layerIdsRef.current = [];
      return;
    }

    const newLayerIds: string[] = [];

    // Render each granule as its own layer
    // Lower index = earlier acquisition = rendered first (bottom)
    decodedLayers.forEach((layer, index) => {
      const layerId = `${LAYER_PREFIX}${index}`;
      newLayerIds.push(layerId);

      updateLayer({
        id: layerId,
        type: 'bitmap',
        visible: true,
        image: layer.image,
        bounds: layer.bounds,
        opacity: opacity,
      });

      console.log(`[EcostressStacked] Layer ${index}: ${layer.granuleId} (${layer.datetime})`);
    });

    // Remove old layers that are no longer needed
    layerIdsRef.current
      .filter(id => !newLayerIds.includes(id))
      .forEach(id => removeLayer(id));

    layerIdsRef.current = newLayerIds;

    return () => {
      // Don't cleanup on every render, only on unmount
    };
  }, [visible, decodedLayers, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      layerIdsRef.current.forEach(id => removeLayer(id));
      decodedLayers.forEach(layer => {
        try { layer.image.close(); } catch { /* ignore */ }
      });
    };
  }, []);

  return null;
}
