import { useEffect, useState, useRef } from 'react';
import { updateLayer, removeLayer, getAttachedMap } from '../DeckOverlayManager';
import { createComposite, type CompositeResult } from './compositeUtils';
import { supabase } from '@/integrations/supabase/client';

interface GranuleData {
  cog_url: string;
  datetime: string;
  granule_id: string;
  granule_bounds: [number, number, number, number];
  quality_score: number;
  coverage_percent: number;
  cloud_percent: number;
}

interface EcostressCompositeOverlayProps {
  map?: any;
  visible: boolean;
  opacity?: number;
  allGranules?: GranuleData[];
  regionBbox?: [number, number, number, number];
}

export function EcostressCompositeOverlay({
  visible,
  opacity = 0.8,
  allGranules = [], // Standardmäßig leer
  regionBbox,
}: EcostressCompositeOverlayProps) {
  const [internalGranules, setInternalGranules] = useState<GranuleData[]>([]);
  const [layerData, setLayerData] = useState<{ image: HTMLCanvasElement; bounds: [number, number, number, number] } | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. DATA FETCHING (Fallback-Modus)
  useEffect(() => {
    // Wenn wir von außen Daten bekommen, nutzen wir die.
    if (allGranules && allGranules.length > 0) {
      setInternalGranules(allGranules);
      return;
    }

    // Wenn nicht sichtbar oder keine Region, nichts tun.
    if (!visible || !regionBbox) return;

    // SELBSTSTÄNDIG DATEN LADEN
    const fetchGranules = async () => {
      setLoading(true);
      console.log('[Ecostress] Fetching data for region:', regionBbox);

      try {
        const centerLat = (regionBbox[1] + regionBbox[3]) / 2;
        const centerLon = (regionBbox[0] + regionBbox[2]) / 2;

        const { data, error } = await supabase.functions.invoke('ecostress-latest-tile', {
          body: {
            lat: centerLat,
            lon: centerLon,
            region_bbox: regionBbox,
            date_from: getDaysAgo(60), // Letzte 2 Monate (Sommer)
            date_to: new Date().toISOString().split('T')[0],
          },
        });

        if (error) throw error;

        if (data?.all_granules && Array.isArray(data.all_granules)) {
          console.log(`[Ecostress] Fetched ${data.all_granules.length} granules via Edge Function.`);
          setInternalGranules(data.all_granules);
        } else {
          console.warn('[Ecostress] No granules found in response:', data);
          setInternalGranules([]);
        }
      } catch (err) {
        console.error('[Ecostress] Data fetch failed:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchGranules();
  }, [visible, regionBbox, allGranules]); // Re-run wenn Region oder Sichtbarkeit sich ändert

  // 2. COMPOSITE GENERATION
  useEffect(() => {
    // Wenn keine Daten da sind (weder von außen noch intern), Layer entfernen
    const granulesToUse = allGranules.length > 0 ? allGranules : internalGranules;

    if (!visible || !regionBbox || granulesToUse.length === 0) {
      removeLayer('ecostress-composite');
      return;
    }

    let active = true;

    async function generate() {
      try {
        console.log('[Ecostress] Generating composite from', granulesToUse.length, 'granules...');
        const result = await createComposite(granulesToUse, regionBbox!, 'median');
        
        if (!active) return;
        if (!result) {
          console.warn('[Ecostress] Composite generation returned empty result.');
          return;
        }

        // Convert ImageData to Canvas for Deck.gl
        const cvs = document.createElement('canvas');
        cvs.width = result.imageData.width;
        cvs.height = result.imageData.height;
        const ctx = cvs.getContext('2d');
        if (!ctx) return;
        ctx.putImageData(result.imageData, 0, 0);

        setLayerData({ image: cvs, bounds: result.bounds });
        console.log('[Ecostress] Composite generated successfully.', result.bounds);

      } catch (e) {
        console.error('[Ecostress] Generation failed:', e);
      }
    }

    generate();
    return () => { active = false; };
  }, [visible, regionBbox, allGranules, internalGranules]);

  // 3. DECK.GL LAYER UPDATE
  useEffect(() => {
    if (!visible || !layerData) {
      removeLayer('ecostress-composite');
      return;
    }

    // CRITICAL FIX: Bounds Order Normalization
    // Deck.gl BitmapLayer erwartet: [West, South, East, North]
    // Wir sortieren die Werte, um sicherzugehen.
    const b = layerData.bounds;
    const west = Math.min(b[0], b[2]);
    const south = Math.min(b[1], b[3]);
    const east = Math.max(b[0], b[2]);
    const north = Math.max(b[1], b[3]);

    const safeBounds: [number, number, number, number] = [west, south, east, north];

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

// Helper
function getDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export default EcostressCompositeOverlay;
