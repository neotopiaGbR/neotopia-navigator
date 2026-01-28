/**
 * ECOSTRESS LAYER
 * 
 * Pure layer producer for the DeckOverlayManager.
 * Does NOT create its own MapboxOverlay - just provides layers.
 * 
 * Uses Canvas/ImageBitmap for reliable texture upload (NO DataURL).
 * All bounds are explicit WGS84 [west, south, east, north].
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { BitmapLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Layer, COORDINATE_SYSTEM } from '@deck.gl/core';
import { useDeckOverlay } from './DeckOverlayManager';
import { 
  createComposite, 
  type AggregationMethod,
  type CompositeResult,
} from './ecostress/compositeUtils';

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

export interface CompositeMetadata {
  timeWindow: { from: string; to: string };
  acquisitionCount: number;
  successfulGranules: number;
  discardedGranules: number;
  aggregationMethod: AggregationMethod;
  minTemp: number;
  maxTemp: number;
  p5Temp: number;
  p95Temp: number;
  validPixels: number;
  totalPixels: number;
  coverageConfidence: { level: 'high' | 'medium' | 'low'; percent: number; reason: string };
}

interface EcostressLayerProps {
  visible: boolean;
  opacity?: number;
  allGranules?: GranuleData[];
  regionBbox?: [number, number, number, number];
  aggregationMethod?: AggregationMethod;
  onMetadata?: (metadata: CompositeMetadata | null) => void;
  onStatus?: (status: 'loading' | 'rendered' | 'error' | 'no_data', message?: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSERTIONS
// ═══════════════════════════════════════════════════════════════════════════

function assertValidBounds(bounds: [number, number, number, number], label: string) {
  const [west, south, east, north] = bounds;
  
  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) {
    throw new Error(`[ECOSTRESS] ${label}: Non-finite bounds [${bounds.join(', ')}]`);
  }
  
  if (west >= east) throw new Error(`[ECOSTRESS] ${label}: Inverted lon: west=${west} >= east=${east}`);
  if (south >= north) throw new Error(`[ECOSTRESS] ${label}: Inverted lat: south=${south} >= north=${north}`);
  if (west < -180 || east > 180) throw new Error(`[ECOSTRESS] ${label}: Lon out of range`);
  if (south < -90 || north > 90) throw new Error(`[ECOSTRESS] ${label}: Lat out of range`);
}

function countOpaquePixels(imageData: ImageData, sampleStep = 16): number {
  let count = 0;
  for (let i = 3; i < imageData.data.length; i += 4 * sampleStep) {
    if (imageData.data[i] > 0) count++;
  }
  return count;
}

function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[ECOSTRESS] Failed to get canvas 2D context');
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function EcostressLayer({
  visible,
  opacity = 0.8,
  allGranules,
  regionBbox,
  aggregationMethod = 'median',
  onMetadata,
  onStatus,
}: EcostressLayerProps) {
  const { setLayers, isReady } = useDeckOverlay();
  
  // Cached composite data
  const compositeRef = useRef<{
    result: CompositeResult | null;
    canvas: HTMLCanvasElement | null;
    key: string;
  }>({ result: null, canvas: null, key: '' });
  
  const [status, setStatus] = useState<'idle' | 'loading' | 'rendered' | 'error'>('idle');
  
  // Build cache key
  const granuleKey = allGranules 
    ? `${allGranules.length}-${allGranules[0]?.granule_id || ''}-${aggregationMethod}`
    : '';
  const bboxKey = regionBbox ? regionBbox.join(',') : '';
  const cacheKey = `${granuleKey}:${bboxKey}`;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD LAYERS
  // ═══════════════════════════════════════════════════════════════════════════
  const buildLayers = useCallback((): Layer[] => {
    if (!visible || !compositeRef.current.canvas || !compositeRef.current.result) {
      return [];
    }
    
    const { result, canvas } = compositeRef.current;
    const layers: Layer[] = [];
    
    try {
      // Validate bounds
      assertValidBounds(result.bounds, 'ECOSTRESS composite');
      
      // Create BitmapLayer with Canvas (NOT DataURL)
      const bitmapLayer = new BitmapLayer({
        id: 'ecostress-heat-composite',
        bounds: result.bounds, // [west, south, east, north]
        image: canvas, // HTMLCanvasElement
        opacity: import.meta.env.DEV ? 1 : opacity,
        visible: true,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        parameters: { depthTest: false },
      });
      
      layers.push(bitmapLayer);
      
      // Debug corners in DEV
      if (import.meta.env.DEV) {
        const [w, s, e, n] = result.bounds;
        const corners = [
          { p: [w, s] as [number, number], label: 'SW' },
          { p: [w, n] as [number, number], label: 'NW' },
          { p: [e, n] as [number, number], label: 'NE' },
          { p: [e, s] as [number, number], label: 'SE' },
          { p: [(w + e) / 2, (s + n) / 2] as [number, number], label: 'C' },
        ];
        
        const debugLayer = new ScatterplotLayer({
          id: 'ecostress-debug-corners',
          data: corners,
          getPosition: (d: { p: [number, number] }) => d.p,
          getFillColor: [0, 255, 0, 255], // Green for ECOSTRESS corners
          getRadius: 40,
          radiusUnits: 'pixels',
          opacity: 1,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          parameters: { depthTest: false },
        });
        
        layers.push(debugLayer);
      }
      
      console.log('[EcostressLayer] Built layers:', {
        bounds: result.bounds,
        canvasSize: `${canvas.width}x${canvas.height}`,
        opacity,
      });
      
    } catch (err) {
      console.error('[EcostressLayer] Failed to build layers:', err);
      onStatus?.('error', String(err));
    }
    
    return layers;
  }, [visible, opacity, onStatus]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE COMPOSITE
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!visible || !allGranules || allGranules.length === 0 || !regionBbox) {
      compositeRef.current = { result: null, canvas: null, key: '' };
      setLayers([]);
      return;
    }
    
    // Check cache
    if (compositeRef.current.key === cacheKey && compositeRef.current.result) {
      console.log('[EcostressLayer] Using cached composite');
      setLayers(buildLayers());
      return;
    }
    
    let cancelled = false;
    
    async function build() {
      setStatus('loading');
      onStatus?.('loading', `Creating composite from ${allGranules!.length} granules...`);
      
      try {
        const granuleInputs = allGranules!.map(g => ({
          cog_url: g.cog_url,
          datetime: g.datetime,
          granule_id: g.granule_id,
          cloud_percent: g.cloud_percent,
          coverage_percent: g.coverage_percent,
          quality_score: g.quality_score,
        }));
        
        const result = await createComposite(
          granuleInputs,
          regionBbox!,
          aggregationMethod,
        );
        
        if (cancelled) return;
        
        if (!result) {
          setStatus('error');
          onStatus?.('no_data', 'No valid granules after quality filtering');
          onMetadata?.(null);
          setLayers([]);
          return;
        }
        
        // Validate bounds
        assertValidBounds(result.bounds, 'Composite result');
        
        // Validate non-empty canvas
        const opaqueCount = countOpaquePixels(result.imageData, 16);
        if (opaqueCount === 0) {
          throw new Error(`Composite is fully transparent (0 opaque pixels sampled)`);
        }
        
        console.log('[EcostressLayer] Composite created:', {
          bounds: result.bounds,
          imageSize: `${result.imageData.width}x${result.imageData.height}`,
          opaquePixels: opaqueCount,
          granules: result.stats.successfulGranules,
        });
        
        // Convert to Canvas (more reliable than DataURL)
        const canvas = imageDataToCanvas(result.imageData);
        
        // Cache
        compositeRef.current = { result, canvas, key: cacheKey };
        
        // Build and set layers
        setStatus('rendered');
        onStatus?.('rendered', `Composite: ${result.stats.successfulGranules} granules`);
        
        // Callback with metadata
        onMetadata?.({
          timeWindow: result.metadata.timeWindow,
          acquisitionCount: result.stats.granuleCount,
          successfulGranules: result.stats.successfulGranules,
          discardedGranules: result.stats.discardedGranules,
          aggregationMethod: result.stats.aggregationMethod,
          minTemp: result.stats.min,
          maxTemp: result.stats.max,
          p5Temp: result.stats.p5,
          p95Temp: result.stats.p95,
          validPixels: result.stats.validPixels,
          totalPixels: result.stats.totalPixels,
          coverageConfidence: result.metadata.coverageConfidence,
        });
        
        // Update layers via manager
        setLayers(buildLayers());
        
      } catch (err) {
        if (cancelled) return;
        console.error('[EcostressLayer] Failed to create composite:', err);
        setStatus('error');
        onStatus?.('error', String(err));
        setLayers([]);
      }
    }
    
    build();
    
    return () => { cancelled = true; };
  }, [visible, cacheKey, aggregationMethod, regionBbox, allGranules, setLayers, buildLayers, onStatus, onMetadata]);
  
  // Update layers when visibility/opacity changes
  useEffect(() => {
    if (isReady && compositeRef.current.result) {
      setLayers(buildLayers());
    }
  }, [visible, opacity, isReady, buildLayers, setLayers]);
  
  return null; // This is a layer producer, not a visual component
}

export default EcostressLayer;
