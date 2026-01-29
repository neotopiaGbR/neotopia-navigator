/**
 * ECOSTRESS Summer Composite Overlay
 * * Renders a single, stable heat map from aggregated ECOSTRESS data.
 * Uses quality-weighted pixel aggregation with regional percentile normalization.
 * * CRITICAL FIXES:
 * - Uses singleton DeckOverlayManager
 * - Removed "isReady()" deadlock that prevented rendering
 * - Validates bounds before rendering
 */

import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { 
  updateLayer, 
  removeLayer, 
  getAttachedMap,
  getDiagnostics,
} from '../DeckOverlayManager';
import { 
  createComposite, 
  type AggregationMethod,
  type CompositeResult,
  type CoverageConfidence,
} from './compositeUtils';
import { 
  isValidWGS84Bounds, 
  boundsIntersect, 
  GERMANY_BBOX,
} from '@/lib/boundsValidation';

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
  coverageConfidence: CoverageConfidence;
}

interface EcostressCompositeOverlayProps {
  map: MapLibreMap | null;
  visible: boolean;
  opacity?: number;
  allGranules?: GranuleData[];
  regionBbox?: [number, number, number, number];
  aggregationMethod?: AggregationMethod;
  onRenderStatus?: (status: 'loading' | 'rendered' | 'error' | 'no_data', message?: string) => void;
  onMetadata?: (metadata: CompositeMetadata | null) => void;
}

const LAYER_ID = 'ecostress-summer-composite';

/**
 * Convert ImageData to HTMLCanvasElement
 */
function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas 2d context');
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Validate bounds are plausible WGS84
 */
function validateBounds(bounds: [number, number, number, number]): boolean {
  if (!isValidWGS84Bounds(bounds)) {
    console.error('[EcostressCompositeOverlay] Bounds outside WGS84 range:', bounds);
    return false;
  }
  // Warn but don't fail if outside Germany (e.g. border regions)
  if (!boundsIntersect(bounds, GERMANY_BBOX)) {
    console.warn('[EcostressCompositeOverlay] Bounds do not intersect Germany:', bounds);
  }
  return true;
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
}: EcostressCompositeOverlayProps) {
  const [compositeResult, setCompositeResult] = useState<CompositeResult | null>(null);
  const [canvasImage, setCanvasImage] = useState<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'rendered' | 'error' | 'no_data'>('idle');
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  
  // Stabilize callbacks
  const onRenderStatusRef = useRef(onRenderStatus);
  const onMetadataRef = useRef(onMetadata);
  onRenderStatusRef.current = onRenderStatus;
  onMetadataRef.current = onMetadata;
  
  // Stabilize inputs
  const granuleKey = allGranules 
    ? `${allGranules.length}-${allGranules[0]?.granule_id || 'none'}`
    : 'none';
  const bboxKey = regionBbox ? regionBbox.join(',') : 'none';

  // 1. Compute Composite (Expensive CPU Task)
  useEffect(() => {
    if (!visible || !allGranules || allGranules.length === 0 || !regionBbox) {
      setCompositeResult(null);
      setCanvasImage(null);
      setStatus('idle');
      onMetadataRef.current?.(null);
      removeLayer(LAYER_ID);
      return;
    }

    let cancelled = false;

    async function buildComposite() {
      setStatus('loading');
      onRenderStatusRef.current?.('loading', `Erstelle Sommer-Komposit aus ${allGranules!.length} Aufnahmen...`);
      setProgress({ loaded: 0, total: allGranules!.length });

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
          (loaded, total) => {
            if (!cancelled) setProgress({ loaded, total });
          }
        );

        if (cancelled) return;

        if (!result) {
          setStatus('no_data');
          onRenderStatusRef.current?.('no_data', 'Keine gültigen Daten für Komposit');
          onMetadataRef.current?.(null);
          return;
        }

        if (!validateBounds(result.bounds)) {
          throw new Error(`Invalid composite bounds: ${JSON.stringify(result.bounds)}`);
        }

        // Create Canvas for Deck.gl
        const canvas = imageDataToCanvas(result.imageData);
        
        setCompositeResult(result);
        setCanvasImage(canvas);
        setStatus('rendered');

        const metadata: CompositeMetadata = {
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
        };

        onMetadataRef.current?.(metadata);
        
        const confidenceLabel = result.metadata.coverageConfidence.level === 'high' ? 'Hoch' 
          : result.metadata.coverageConfidence.level === 'medium' ? 'Mittel' : 'Gering';
        
        onRenderStatusRef.current?.(
          'rendered', 
          `Komposit: ${result.stats.successfulGranules} Aufnahmen, ${result.metadata.coverageConfidence.percent}% Abdeckung (${confidenceLabel})`
        );

      } catch (err) {
        if (cancelled) return;
        console.error('[EcostressCompositeOverlay] Failed to create composite:', err);
        setStatus('error');
        onRenderStatusRef.current?.('error', err instanceof Error ? err.message : 'Unbekannter Fehler');
      } finally {
        setProgress(null);
      }
    }

    buildComposite();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, granuleKey, bboxKey, aggregationMethod]);

  // 2. Render to Map (Deck.gl Layer Update)
  useEffect(() => {
    // FIX: Don't check isReady() which relies on DOM. 
    // Just check if we have a map attached (via manager) or we are passed one.
    if (!getAttachedMap() && !map) {
      // Not mounted on a map yet
      return;
    }
    
    if (!visible || !canvasImage || !compositeResult) {
      removeLayer(LAYER_ID);
      return;
    }

    console.log('[EcostressCompositeOverlay] Updating Layer:', {
      bounds: compositeResult.bounds,
      opacity,
      size: `${canvasImage.width}x${canvasImage.height}`,
    });

    updateLayer({
      id: LAYER_ID,
      type: 'bitmap',
      visible: true,
      image: canvasImage,
      bounds: compositeResult.bounds,
      opacity,
    });

    return () => {
      // We don't remove the layer on unmount immediately to prevent flicker
      // The parent component controls visibility usually. 
      // But if this component unmounts, we should clean up.
      removeLayer(LAYER_ID);
    };
  }, [visible, canvasImage, compositeResult, opacity, map]);

  // UI Rendering
  if (!visible) return null;

  if (status === 'loading' && progress) {
    return (
      <div className="absolute top-16 right-4 bg-background/90 backdrop-blur px-3 py-2 rounded-lg text-sm z-10 flex items-center gap-2 shadow-lg border border-border/50">
        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <div>
          <div className="font-medium">Erstelle Sommer-Komposit</div>
          <div className="text-xs text-muted-foreground">
            {progress.loaded} von {progress.total} Aufnahmen geladen...
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="absolute top-16 right-4 bg-destructive/10 text-destructive px-3 py-2 rounded-lg text-sm max-w-xs z-10 shadow-lg border border-destructive/30">
        <strong>Fehler:</strong> Komposit konnte nicht erstellt werden.
      </div>
    );
  }

  if (status === 'rendered' && compositeResult) {
    const minC = (compositeResult.stats.min - 273.15).toFixed(1);
    const maxC = (compositeResult.stats.max - 273.15).toFixed(1);
    const p5C = (compositeResult.stats.p5 - 273.15).toFixed(1);
    const p95C = (compositeResult.stats.p95 - 273.15).toFixed(1);
    const methodLabel = compositeResult.stats.aggregationMethod === 'max' ? 'Maximum (Heißeste)' : compositeResult.stats.aggregationMethod === 'p90' ? 'P90 (Extreme)' : 'Median';
    const confidence = compositeResult.metadata.coverageConfidence;
    
    const fromDate = compositeResult.metadata.timeWindow.from 
      ? new Date(compositeResult.metadata.timeWindow.from).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
      : '';
    const toDate = compositeResult.metadata.timeWindow.to
      ? new Date(compositeResult.metadata.timeWindow.to).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
      : '';

    const confidenceColor = confidence.level === 'high' 
      ? 'bg-green-500' 
      : confidence.level === 'medium' 
        ? 'bg-yellow-500' 
        : 'bg-orange-500';
    
    const confidenceLabel = confidence.level === 'high' ? 'Hoch' 
      : confidence.level === 'medium' ? 'Mittel' : 'Gering';

    return (
      <div className="absolute top-16 right-4 bg-background/95 backdrop-blur px-3 py-2.5 rounded-lg text-xs z-10 shadow-lg border border-border/50 min-w-[220px]">
        <div className="font-medium text-sm mb-2">Hitze-Hotspots – Sommer-Komposit</div>
        
        <div className="flex items-center gap-2 mb-2 p-1.5 rounded bg-muted/50">
          <div className={`w-2 h-2 rounded-full ${confidenceColor}`} />
          <span className="text-foreground font-medium">Konfidenz: {confidenceLabel}</span>
          <span className="text-muted-foreground">({confidence.percent}%)</span>
        </div>
        
        <div className="space-y-1 text-muted-foreground">
          <div className="flex justify-between">
            <span>Zeitraum:</span>
            <span className="text-foreground">{fromDate} – {toDate}</span>
          </div>
          <div className="flex justify-between">
            <span>Aggregation:</span>
            <span className="text-foreground">{methodLabel}</span>
          </div>
          <div className="flex justify-between">
            <span>Aufnahmen:</span>
            <span className="text-foreground">
              {compositeResult.stats.successfulGranules}
              {compositeResult.stats.discardedGranules > 0 && (
                <span className="text-muted-foreground"> (−{compositeResult.stats.discardedGranules} verworfen)</span>
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Normalisierung:</span>
            <span className="text-foreground">{p5C}°C – {p95C}°C (P5–P95)</span>
          </div>
          <div className="flex justify-between">
            <span>Absoluter Bereich:</span>
            <span className="text-foreground">{minC}°C – {maxC}°C</span>
          </div>
        </div>

        <div className="mt-2.5 h-2 w-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 via-green-500 via-yellow-400 via-orange-500 to-red-500" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>{p5C}°C</span>
          <span>{p95C}°C</span>
        </div>

        <div className="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground/70 leading-relaxed">
          Diese Ebene zeigt aggregierte Sommerwärme (nicht Einzelaufnahme). 
          Farbskala regional normalisiert (P5–P95).
        </div>
      </div>
    );
  }

  return null;
}

export default EcostressCompositeOverlay;
