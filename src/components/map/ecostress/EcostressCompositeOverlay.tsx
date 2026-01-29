import { useEffect, useState, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { createComposite, type AggregationMethod } from './compositeUtils';
import { isValidWGS84Bounds } from '@/lib/boundsValidation';

// ... (Your interface definitions remain the same) ...
// Copy them from your existing file or the previous patch if missing

export interface GranuleData {
  cog_url: string;
  datetime: string;
  granule_id: string;
  granule_bounds: [number, number, number, number];
  quality_score: number;
  coverage_percent: number;
  cloud_percent: number;
}

export function EcostressCompositeOverlay({
  map,
  visible,
  opacity = 0.8,
  allGranules,
  regionBbox,
  aggregationMethod = 'median',
  onRenderStatus,
  onMetadata,
}: any) { // Using 'any' for props briefly to save space, keep your interfaces!

  const [canvasImage, setCanvasImage] = useState<HTMLCanvasElement | null>(null);
  const [compositeBounds, setCompositeBounds] = useState<[number, number, number, number] | null>(null);
  const [status, setStatus] = useState('idle');

  // Generation Effect
  useEffect(() => {
    if (!visible || !allGranules?.length || !regionBbox) {
      removeLayer('ecostress-composite');
      return;
    }

    let active = true;

    async function generate() {
      setStatus('loading');
      onRenderStatus?.('loading');

      try {
        console.log('[Ecostress] Starting composite generation...');
        
        // 1. Generate Composite
        const result = await createComposite(
          allGranules,
          regionBbox,
          aggregationMethod
        );

        if (!active) return;
        if (!result) throw new Error('Composite result was empty');

        // 2. Convert ImageData to Canvas
        const canvas = document.createElement('canvas');
        canvas.width = result.imageData.width;
        canvas.height = result.imageData.height;
        const ctx = canvas.getContext('2d');
        ctx?.putImageData(result.imageData, 0, 0);

        // 3. Store Result
        setCanvasImage(canvas);
        setCompositeBounds(result.bounds);
        setStatus('rendered');
        onRenderStatus?.('rendered');
        onMetadata?.(result.metadata);
        
        console.log('[Ecostress] Generated.', { 
            width: canvas.width, 
            bounds: result.bounds 
        });

      } catch (e) {
        console.error('[Ecostress] Error:', e);
        setStatus('error');
        onRenderStatus?.('error');
      }
    }

    generate();

    return () => { active = false; };
  }, [visible, allGranules, regionBbox, aggregationMethod]);

  // Layer Update Effect
  useEffect(() => {
    // SECURITY CHECK: Do not attempt update if we have no valid data
    if (!visible || !canvasImage || !compositeBounds) {
      removeLayer('ecostress-composite');
      return;
    }

    // SAFETY: Ensure bounds are [West, South, East, North]
    // If South > North, the image will be invisible or inverted.
    const [b1, b2, b3, b4] = compositeBounds;
    const west = Math.min(b1, b3);
    const east = Math.max(b1, b3);
    const south = Math.min(b2, b4);
    const north = Math.max(b2, b4);
    const safeBounds: [number, number, number, number] = [west, south, east, north];

    console.log('[Ecostress] Updating Deck Layer', safeBounds);

    updateLayer({
      id: 'ecostress-composite',
      type: 'bitmap',
      visible: true,
      opacity,
      image: canvasImage,
      bounds: safeBounds,
    });

  }, [visible, canvasImage, compositeBounds, opacity]);

  return null; // This component has no DOM UI itself, it renders into Deck.gl
}

export default EcostressCompositeOverlay;
