import { useEffect, useState } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { createComposite } from './compositeUtils';

export interface GranuleData {
  cog_url: string;
  cloud_mask_url?: string;
  datetime: string;
  granule_id: string;
  granule_bounds: [number, number, number, number];
  quality_score: number;
  coverage_percent: number;
  cloud_percent: number;
}

// Minimal metadata type exported for downstream consumers
export interface CompositeMetadata {
  granuleCount?: number;
}

// Define minimal Props needed
interface Props {
  map: any;
  visible: boolean;
  allGranules?: GranuleData[];
  regionBbox?: [number, number, number, number];
  opacity?: number;
}

export function EcostressCompositeOverlay({
  visible,
  allGranules,
  regionBbox,
  opacity = 0.8
}: Props) {
  const [layerData, setLayerData] = useState<{image: HTMLCanvasElement, bounds: any} | null>(null);

  // 1. Generation Logic (CPU Intensive)
  useEffect(() => {
    if (!visible || !allGranules?.length || !regionBbox) {
      setLayerData(null);
      removeLayer('ecostress-composite');
      return;
    }

    let active = true;

    async function gen() {
      try {
        const res = await createComposite(allGranules!, regionBbox!, 'median');
        if (!active || !res) return;

        // Convert ImageData to Canvas for Deck.gl
        const cvs = document.createElement('canvas');
        cvs.width = res.imageData.width;
        cvs.height = res.imageData.height;
        const ctx = cvs.getContext('2d');
        ctx?.putImageData(res.imageData, 0, 0);

        setLayerData({ image: cvs, bounds: res.bounds });
      } catch (e) {
        console.error('Composite gen failed', e);
      }
    }
    gen();
    return () => { active = false; };
  }, [visible, allGranules, regionBbox]);

  // 2. Render Logic (Deck.gl Update)
  useEffect(() => {
    if (!visible || !layerData) {
      removeLayer('ecostress-composite');
      return;
    }

    // ARCHITECT FIX: Validate Bounds Order [W, S, E, N]
    const b = layerData.bounds;
    const safeBounds: [number, number, number, number] = [
      Math.min(b[0], b[2]), // West
      Math.min(b[1], b[3]), // South
      Math.max(b[0], b[2]), // East
      Math.max(b[1], b[3])  // North
    ];

    updateLayer({
      id: 'ecostress-composite',
      type: 'bitmap',
      visible: true,
      image: layerData.image,
      bounds: safeBounds,
      opacity
    });

  }, [visible, layerData, opacity]);

  return null;
}

export default EcostressCompositeOverlay;
