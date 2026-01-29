import { useEffect, useState, useRef, useCallback } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { createComposite, type AggregationMethod, type GranuleInput } from './compositeUtils';
import { supabase } from '@/integrations/supabase/client';
import { useMapLayers } from '../MapLayersContext';

interface Props {
  visible: boolean;
  opacity?: number;
  allGranules?: GranuleInput[];
  regionBbox?: [number, number, number, number];
  aggregationMethod?: AggregationMethod;
}

const LAYER_ID = 'ecostress-composite';

/**
 * ECOSTRESS Summer Composite Overlay
 * 
 * Renders a heat-colorized bitmap from multiple ECOSTRESS granules.
 * Uses deck.gl BitmapLayer via DeckOverlayManager singleton.
 * 
 * CRITICAL: Uses createImageBitmap for stable WebGL texture uploads.
 */
export default function EcostressCompositeOverlay({
  visible,
  opacity = 0.8,
  allGranules = [],
  regionBbox,
  aggregationMethod = 'p90',
}: Props) {
  const { setEcostressStats } = useMapLayers();
  const [layerData, setLayerData] = useState<{ image: ImageBitmap; bounds: [number, number, number, number] } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [fetchedGranules, setFetchedGranules] = useState<GranuleInput[]>([]);
  
  // Refs to track previous values and avoid redundant regeneration
  const prevGranulesKeyRef = useRef<string>('');
  const prevAggregationRef = useRef<AggregationMethod>(aggregationMethod);
  const generationIdRef = useRef(0);

  // Use either prop granules or self-fetched granules
  const effectiveGranules = allGranules.length > 0 ? allGranules : fetchedGranules;

  // Create a stable key for granules to detect actual changes
  const granulesKey = effectiveGranules.length > 0 
    ? `${effectiveGranules.length}-${effectiveGranules[0]?.granule_id || ''}-${effectiveGranules[effectiveGranules.length - 1]?.granule_id || ''}`
    : '';

  // Self-fetch granules if not provided via props
  // Backend now handles all date logic: Multi-summer parallel queries (2023-2025)
  // with strict peak-heat UTC filter (10:00-15:00 UTC = 12:00-17:00 CEST)
  useEffect(() => {
    if (!visible || !regionBbox || allGranules.length > 0) {
      return;
    }

    const fetchGranules = async () => {
      const centerLat = (regionBbox[1] + regionBbox[3]) / 2;
      const centerLon = (regionBbox[0] + regionBbox[2]) / 2;

      console.log('[EcostressComposite] Fetching multi-summer peak-heat data for region:', regionBbox);

      try {
        // Backend now handles all summer date logic via parallel queries
        const { data, error } = await supabase.functions.invoke('ecostress-latest-tile', {
          body: {
            lat: centerLat,
            lon: centerLon,
            region_bbox: regionBbox,
            mode: 'historic_heat',
            max_granules: 100,
          },
        });

        if (error) {
          console.error('[EcostressComposite] Fetch error:', error);
          return;
        }

        if (data?.status === 'match' && Array.isArray(data.all_granules)) {
          const yearDist = data.year_distribution || {};
          
          // VALIDATION: Log actual years present in granules
          const actualYears = [...new Set(data.all_granules.map((g: GranuleInput) => 
            g.datetime?.substring(0, 4)
          ))].filter(Boolean).sort();
          
          console.log(`[EcostressComposite] ✓ ${data.all_granules.length} peak-heat granules loaded`);
          console.log(`[EcostressComposite] Summers queried:`, data.summers_queried);
          console.log(`[EcostressComposite] Year distribution (from API):`, yearDist);
          console.log(`[EcostressComposite] Actual years in granules:`, actualYears);
          console.log(`[EcostressComposite] Filter: ${data.peak_heat_filter}`);
          
          if (actualYears.length < 3) {
            console.warn(`[EcostressComposite] ⚠️ Only ${actualYears.length} years loaded: ${actualYears.join(', ')}`);
          }
          
          setFetchedGranules(data.all_granules);
        } else if (data?.status === 'no_coverage') {
          console.warn('[EcostressComposite] No peak-heat coverage:', data.message);
        }
      } catch (err) {
        console.error('[EcostressComposite] Fetch exception:', err);
      }
    };

    fetchGranules();
  }, [visible, regionBbox, allGranules.length]);

  // Generate composite when granules or aggregation method changes
  // Uses debounce to prevent rapid re-triggering when user clicks quickly
  useEffect(() => {
    // Skip if not visible or no data
    if (!visible || !regionBbox || effectiveGranules.length === 0) {
      // Clear layer if we were previously showing something
      if (layerData) {
        removeLayer(LAYER_ID);
        if (layerData.image) {
          try { layerData.image.close(); } catch { /* ignore */ }
        }
        setLayerData(null);
      }
      return;
    }

    // Skip only if BOTH granules AND aggregation are unchanged
    const granulesUnchanged = granulesKey === prevGranulesKeyRef.current;
    const aggregationUnchanged = aggregationMethod === prevAggregationRef.current;
    
    if (granulesUnchanged && aggregationUnchanged && layerData) {
      console.log('[EcostressComposite] No change, skipping regeneration');
      return;
    }
    
    // Force regenerate if aggregation changed
    if (!aggregationUnchanged) {
      console.log(`[EcostressComposite] Aggregation changed: ${prevAggregationRef.current} → ${aggregationMethod}`);
    }

    // DEBOUNCE: Wait 300ms before starting generation to prevent rapid re-triggers
    const debounceTimer = setTimeout(() => {
      // Track this generation to handle race conditions
      const genId = ++generationIdRef.current;
      prevGranulesKeyRef.current = granulesKey;
      prevAggregationRef.current = aggregationMethod;
      
      runGeneration(genId);
    }, 300);

    return () => {
      clearTimeout(debounceTimer);
    };
  }, [visible, regionBbox, granulesKey, aggregationMethod, effectiveGranules]);

  // Extracted generation logic for cleaner code
  const runGeneration = async (genId: number) => {
    setIsGenerating(true);
    console.log(`[EcostressComposite] Starting ${aggregationMethod.toUpperCase()} composite from ${effectiveGranules.length} granules...`);
      
    try {
      // Use the dynamic aggregation method from props (p90 or max)
      const result = await createComposite(effectiveGranules, regionBbox!, aggregationMethod);
      
      // Check if this generation is still current
      if (genId !== generationIdRef.current) {
        console.log('[EcostressComposite] Generation superseded, discarding result');
        setIsGenerating(false);
        return;
      }
      
      if (!result) {
        console.warn('[EcostressComposite] createComposite returned null');
        setIsGenerating(false);
        return;
      }

      console.log(`[EcostressComposite] Composite complete: ${result.stats.validPixels} valid pixels, Ø ${(result.stats.mean - 273.15).toFixed(1)}°C`);

      // Update context with stats for legend display
      setEcostressStats({
        min: result.stats.min,
        max: result.stats.max,
        mean: result.stats.mean,
        validPixels: result.stats.validPixels,
        successfulGranules: result.stats.successfulGranules,
      });

      // CRITICAL: Strictly normalize bounds to [West, South, East, North]
      const rawBounds = result.bounds;
      const normalizedBounds: [number, number, number, number] = [
        Math.min(rawBounds[0], rawBounds[2]), // west (minLon)
        Math.min(rawBounds[1], rawBounds[3]), // south (minLat)
        Math.max(rawBounds[0], rawBounds[2]), // east (maxLon)
        Math.max(rawBounds[1], rawBounds[3]), // north (maxLat)
      ];

      // Validate WGS84 bounds
      if (normalizedBounds[0] < -180 || normalizedBounds[2] > 180 || 
          normalizedBounds[1] < -90 || normalizedBounds[3] > 90) {
        console.error('[EcostressComposite] Invalid WGS84 bounds:', normalizedBounds);
        setIsGenerating(false);
        return;
      }

      // Validate positive area
      if (normalizedBounds[0] >= normalizedBounds[2] || normalizedBounds[1] >= normalizedBounds[3]) {
        console.error('[EcostressComposite] Zero-area bounds:', normalizedBounds);
        setIsGenerating(false);
        return;
      }

      console.log('[EcostressComposite] Normalized bounds:', normalizedBounds);

      // CRITICAL: Create ImageBitmap from ImageData for stable WebGL texture
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
      
      // CRITICAL: Use createImageBitmap with explicit options to prevent WebGL shader crashes
      const bitmap = await createImageBitmap(canvas, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });

      // Check again after async operation
      if (genId !== generationIdRef.current) {
        bitmap.close();
        setIsGenerating(false);
        return;
      }

      // Close previous bitmap if exists
      if (layerData?.image) {
        try { layerData.image.close(); } catch { /* ignore */ }
      }

      setLayerData({ image: bitmap, bounds: normalizedBounds });
      setIsGenerating(false);
      
    } catch (err) {
      console.error('[EcostressComposite] Generation error:', err);
      setIsGenerating(false);
    }
  };

  // Update deck.gl layer when layerData or opacity changes
  useEffect(() => {
    if (!visible || !layerData) {
      removeLayer(LAYER_ID);
      return;
    }

    console.log('[EcostressComposite] Updating deck layer with bounds:', layerData.bounds, 'opacity:', opacity);

    updateLayer({
      id: LAYER_ID,
      type: 'bitmap',
      visible: true,
      image: layerData.image,
      bounds: layerData.bounds,
      opacity,
    });

    return () => {
      // Don't remove on every opacity change, only when truly unmounting
    };
  }, [visible, layerData, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeLayer(LAYER_ID);
      if (layerData?.image) {
        try { layerData.image.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  return null;
}
