import { useEffect, useState } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { createComposite, type AggregationMethod } from './compositeUtils';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  visible: boolean;
  opacity?: number;
  allGranules?: any[];
  regionBbox?: [number, number, number, number];
  aggregationMethod?: AggregationMethod;
}

// NUR "export function", KEIN "export default"
export function EcostressCompositeOverlay({
  visible,
  opacity = 0.8,
  allGranules = [],
  regionBbox,
  aggregationMethod = 'median',
}: Props) {
  const [internalGranules, setInternalGranules] = useState<any[]>([]);
  const [layerData, setLayerData] = useState<{ image: ImageBitmap; bounds: any } | null>(null);

  // 1. Fetching
  useEffect(() => {
    if (allGranules && allGranules.length > 0) {
      setInternalGranules(allGranules);
      return;
    }
    if (!visible || !regionBbox) return;

    const fetchGranules = async () => {
      try {
        const centerLat = (regionBbox[1] + regionBbox[3]) / 2;
        const centerLon = (regionBbox[0] + regionBbox[2]) / 2;

        const { data, error } = await supabase.functions.invoke('ecostress-latest-tile', {
          body: {
            lat: centerLat,
            lon: centerLon,
            region_bbox: regionBbox,
            date_from: getDaysAgo(60),
            date_to: new Date().toISOString().split('T')[0],
          },
        });

        if (!error && data?.all_granules) {
            console.log(`[Ecostress] Fetched ${data.all_granules.length} granules`);
            setInternalGranules(data.all_granules);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchGranules();
  }, [visible, regionBbox, allGranules]);

  // 2. Generation (ImageBitmap)
  useEffect(() => {
    const granulesToUse = allGranules.length > 0 ? allGranules : internalGranules;

    if (!visible || !regionBbox || granulesToUse.length === 0) {
      removeLayer('ecostress-composite');
      return;
    }

    let active = true;

    async function generate() {
      try {
        const result = await createComposite(granulesToUse, regionBbox!, aggregationMethod);
        if (!active || !result) return;

        const cvs = document.createElement('canvas');
        cvs.width = result.imageData.width;
        cvs.height = result.imageData.height;
        const ctx = cvs.getContext('2d');
        if (!ctx) return;
        
        ctx.putImageData(result.imageData, 0, 0);
        
        // ImageBitmap für Performance & Stabilität
        const bitmap = await createImageBitmap(cvs);

        if (active) {
             setLayerData({ image: bitmap, bounds: result.bounds });
        } else {
             bitmap.close();
        }
      } catch (e) {
        console.error('[Ecostress] Bitmap error:', e);
      }
    }

    generate();
    return () => { 
        active = false;
        if (layerData?.image) layerData.image.close();
    };
  }, [visible, regionBbox, allGranules, internalGranules, aggregationMethod]);

  // 3. Update Deck
  useEffect(() => {
    if (!visible || !layerData) {
      removeLayer('ecostress-composite');
      return;
    }

    // Bounds sicherstellen
    const b = layerData.bounds;
    const safeBounds: [number, number, number, number] = [
      Math.min(b[0], b[2]),
      Math.min(b[1], b[3]),
      Math.max(b[0], b[2]),
      Math.max(b[1], b[3])
    ];

    updateLayer({
      id: 'ecostress-composite',
      type: 'bitmap',
      visible: true,
      image: layerData.image,
      bounds: safeBounds,
      opacity,
    });

  }, [visible, layerData, opacity]);

  return null;
}

function getDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
