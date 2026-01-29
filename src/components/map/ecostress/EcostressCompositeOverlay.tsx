import { useEffect, useState, useRef } from 'react';
import { updateLayer, removeLayer, isReady } from '../DeckOverlayManager';
import { createComposite, type AggregationMethod } from './compositeUtils';

interface Props {
  visible: boolean;
  opacity?: number;
  allGranules?: any[];
  regionBbox?: [number, number, number, number];
  aggregationMethod?: AggregationMethod;
}

/**
 * ECOSTRESS Summer Composite Overlay
 * 
 * Renders a heat-colorized bitmap from multiple ECOSTRESS granules.
 * Uses deck.gl BitmapLayer via DeckOverlayManager singleton.
 */
export function EcostressCompositeOverlay({
  visible,
  opacity = 0.8,
  allGranules = [],
  regionBbox,
  aggregationMethod = 'median',
}: Props) {
  const [layerData, setLayerData] = useState<{ image: ImageBitmap; bounds: [number, number, number, number] } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Refs to track previous values and avoid redundant regeneration
  const prevGranulesKeyRef = useRef<string>('');
  const prevAggregationRef = useRef<AggregationMethod>(aggregationMethod);
  const generationIdRef = useRef(0);

  // Create a stable key for granules to detect actual changes
  const granulesKey = allGranules.length > 0 
    ? `${allGranules.length}-${allGranules[0]?.granule_id || ''}-${allGranules[allGranules.length - 1]?.granule_id || ''}`
    : '';

  // Generate composite when granules or aggregation method changes
  useEffect(() => {
    // Skip if not visible or no data
    if (!visible || !regionBbox || allGranules.length === 0) {
      // Clear layer if we were previously showing something
      if (layerData) {
        removeLayer('ecostress-composite');
        if (layerData.image) {
          try { layerData.image.close(); } catch { /* ignore */ }
        }
        setLayerData(null);
      }
      return;
    }

    // Skip if nothing changed (same granules + same aggregation)
    if (granulesKey === prevGranulesKeyRef.current && aggregationMethod === prevAggregationRef.current && layerData) {
      return;
    }

    // Track this generation to handle race conditions
    const genId = ++generationIdRef.current;
    prevGranulesKeyRef.current = granulesKey;
    prevAggregationRef.current = aggregationMethod;

    async function generate() {
      setIsGenerating(true);
      console.log(`[EcostressComposite] Starting ${aggregationMethod} composite from ${allGranules.length} granules...`);
      
      try {
        const result = await createComposite(allGranules, regionBbox!, aggregationMethod);
        
        // Check if this generation is still current
        if (genId !== generationIdRef.current) {
          console.log('[EcostressComposite] Generation superseded, discarding result');
          return;
        }
        
        if (!result) {
          console.warn('[EcostressComposite] createComposite returned null');
          setIsGenerating(false);
          return;
        }

        console.log(`[EcostressComposite] Composite complete: ${result.stats.validPixels} valid pixels, bounds:`, result.bounds);

        // Create ImageBitmap from ImageData for stable WebGL texture
        const canvas = document.createElement('canvas');
        canvas.width = result.imageData.width;
        canvas.height = result.imageData.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('[EcostressComposite] Failed to get canvas context');
          setIsGenerating(false);
          return;
        }
        
        ctx.putImageData(result.imageData, 0, 0);
        const bitmap = await createImageBitmap(canvas);

        // Check again after async operation
        if (genId !== generationIdRef.current) {
          bitmap.close();
          return;
        }

        // Close previous bitmap if exists
        if (layerData?.image) {
          try { layerData.image.close(); } catch { /* ignore */ }
        }

        setLayerData({ image: bitmap, bounds: result.bounds });
        setIsGenerating(false);
        
      } catch (err) {
        console.error('[EcostressComposite] Generation error:', err);
        setIsGenerating(false);
      }
    }

    generate();

    // Cleanup on unmount or when effect re-runs
    return () => {
      // Mark this generation as stale
      generationIdRef.current++;
    };
  }, [visible, regionBbox, granulesKey, aggregationMethod]);

  // Update deck.gl layer when layerData or opacity changes
  useEffect(() => {
    if (!visible || !layerData) {
      removeLayer('ecostress-composite');
      return;
    }

    // Validate and normalize bounds [west, south, east, north]
    const b = layerData.bounds;
    const safeBounds: [number, number, number, number] = [
      Math.min(b[0], b[2]),
      Math.min(b[1], b[3]),
      Math.max(b[0], b[2]),
      Math.max(b[1], b[3])
    ];

    // Sanity check bounds are valid WGS84
    if (safeBounds[0] < -180 || safeBounds[2] > 180 || safeBounds[1] < -90 || safeBounds[3] > 90) {
      console.error('[EcostressComposite] Invalid bounds, skipping layer update:', safeBounds);
      return;
    }

    console.log('[EcostressComposite] Updating deck layer with bounds:', safeBounds, 'opacity:', opacity);

    updateLayer({
      id: 'ecostress-composite',
      type: 'bitmap',
      visible: true,
      image: layerData.image,
      bounds: safeBounds,
      opacity,
    });

    return () => {
      // Don't remove on every opacity change, only when truly unmounting
    };
  }, [visible, layerData, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeLayer('ecostress-composite');
      if (layerData?.image) {
        try { layerData.image.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  return null;
}
