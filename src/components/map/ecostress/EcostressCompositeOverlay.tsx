/**
 * ECOSTRESS Summer Composite Overlay
 * 
 * Renders a single, stable heat map from aggregated ECOSTRESS data.
 * Uses pixel-level median/P90 aggregation - no overlapping swaths.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer } from '@deck.gl/layers';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { 
  createComposite, 
  imageDataToDataUrl, 
  type AggregationMethod,
  type CompositeResult,
} from './compositeUtils';

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
  aggregationMethod: AggregationMethod;
  minTemp: number;
  maxTemp: number;
  validPixels: number;
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
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [compositeResult, setCompositeResult] = useState<CompositeResult | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'rendered' | 'error' | 'no_data'>('idle');
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);

  // Create composite when granules change
  useEffect(() => {
    if (!visible || !allGranules || allGranules.length === 0 || !regionBbox) {
      setCompositeResult(null);
      setImageUrl(null);
      setStatus('idle');
      onMetadata?.(null);
      return;
    }

    let cancelled = false;

    async function buildComposite() {
      setStatus('loading');
      onRenderStatus?.('loading', `Erstelle Sommer-Komposit aus ${allGranules!.length} Aufnahmen...`);
      setProgress({ loaded: 0, total: allGranules!.length });

      try {
        const result = await createComposite(
          allGranules!.map(g => ({
            cog_url: g.cog_url,
            datetime: g.datetime,
            granule_id: g.granule_id,
          })),
          regionBbox!,
          aggregationMethod,
          (loaded, total) => {
            if (!cancelled) {
              setProgress({ loaded, total });
            }
          }
        );

        if (cancelled) return;

        if (!result) {
          setStatus('no_data');
          onRenderStatus?.('no_data', 'Keine gültigen Daten für Komposit');
          onMetadata?.(null);
          return;
        }

        const dataUrl = imageDataToDataUrl(result.imageData);
        setCompositeResult(result);
        setImageUrl(dataUrl);
        setStatus('rendered');

        const metadata: CompositeMetadata = {
          timeWindow: result.metadata.timeWindow,
          acquisitionCount: result.stats.granuleCount,
          successfulGranules: result.stats.successfulGranules,
          aggregationMethod: result.stats.aggregationMethod,
          minTemp: result.stats.min,
          maxTemp: result.stats.max,
          validPixels: result.stats.validPixels,
        };

        onMetadata?.(metadata);
        onRenderStatus?.(
          'rendered', 
          `Komposit aus ${result.stats.successfulGranules} Aufnahmen (${result.stats.validPixels.toLocaleString()} Pixel)`
        );

        console.log('[EcostressCompositeOverlay] Composite created:', {
          granules: result.stats.successfulGranules,
          pixels: result.stats.validPixels,
          tempRange: `${(result.stats.min - 273.15).toFixed(1)}°C to ${(result.stats.max - 273.15).toFixed(1)}°C`,
        });
      } catch (err) {
        if (cancelled) return;
        console.error('[EcostressCompositeOverlay] Failed to create composite:', err);
        setStatus('error');
        onRenderStatus?.('error', err instanceof Error ? err.message : 'Unbekannter Fehler');
      } finally {
        setProgress(null);
      }
    }

    buildComposite();

    return () => {
      cancelled = true;
    };
  }, [visible, allGranules, regionBbox, aggregationMethod, onRenderStatus, onMetadata]);

  // Manage deck.gl overlay - SINGLE BitmapLayer only
  useEffect(() => {
    if (!map) return;

    // Remove existing overlay
    if (overlayRef.current) {
      try {
        map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
      } catch {
        // Ignore
      }
      overlayRef.current = null;
    }

    // Don't add if not visible or no image
    if (!visible || !imageUrl || !compositeResult) {
      return;
    }

    const addOverlay = () => {
      console.log('[EcostressCompositeOverlay] Adding SINGLE composite BitmapLayer');

      try {
        // Create SINGLE BitmapLayer - no overlapping swaths
        const layer = new BitmapLayer({
          id: 'ecostress-summer-composite',
          bounds: compositeResult.bounds,
          image: imageUrl,
          opacity,
          pickable: false,
          parameters: {
            depthTest: false,
          },
        });

        const overlay = new MapboxOverlay({
          interleaved: false,
          layers: [layer],
        });

        map.addControl(overlay as unknown as maplibregl.IControl);
        overlayRef.current = overlay;

        console.log('[EcostressCompositeOverlay] ✅ Single composite overlay mounted');
      } catch (err) {
        console.error('[EcostressCompositeOverlay] Failed to add overlay:', err);
      }
    };

    if (map.isStyleLoaded()) {
      addOverlay();
    } else {
      map.once('style.load', addOverlay);
    }

    return () => {
      if (overlayRef.current && map) {
        try {
          map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
        } catch {
          // Ignore cleanup errors
        }
        overlayRef.current = null;
      }
    };
  }, [map, visible, imageUrl, compositeResult, opacity]);

  // Update opacity without re-creating
  useEffect(() => {
    if (!overlayRef.current || !compositeResult || !imageUrl) return;

    const layer = new BitmapLayer({
      id: 'ecostress-summer-composite',
      bounds: compositeResult.bounds,
      image: imageUrl,
      opacity,
      pickable: false,
      parameters: {
        depthTest: false,
      },
    });

    overlayRef.current.setProps({ layers: [layer] });
  }, [opacity, compositeResult, imageUrl]);

  // Render loading/status UI
  if (!visible) return null;

  if (status === 'loading' && progress) {
    return (
      <div className="absolute top-16 right-4 bg-background/90 backdrop-blur px-3 py-2 rounded-lg text-sm z-10 flex items-center gap-2 shadow-lg">
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
      <div className="absolute top-16 right-4 bg-destructive/10 text-destructive px-3 py-2 rounded-lg text-sm max-w-xs z-10 shadow-lg">
        <strong>Fehler:</strong> Komposit konnte nicht erstellt werden.
      </div>
    );
  }

  if (status === 'rendered' && compositeResult) {
    const minC = (compositeResult.stats.min - 273.15).toFixed(1);
    const maxC = (compositeResult.stats.max - 273.15).toFixed(1);
    const methodLabel = compositeResult.stats.aggregationMethod === 'p90' ? 'P90' : 'Median';
    
    // Format time window
    const fromDate = compositeResult.metadata.timeWindow.from 
      ? new Date(compositeResult.metadata.timeWindow.from).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
      : '';
    const toDate = compositeResult.metadata.timeWindow.to
      ? new Date(compositeResult.metadata.timeWindow.to).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
      : '';

    return (
      <div className="absolute top-16 right-4 bg-background/90 backdrop-blur px-3 py-2.5 rounded-lg text-xs z-10 shadow-lg border border-border/50 min-w-[200px]">
        <div className="font-medium text-sm mb-1.5">Hitze-Hotspots – Sommer-Komposit</div>
        
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
            <span className="text-foreground">{compositeResult.stats.successfulGranules}</span>
          </div>
          <div className="flex justify-between">
            <span>Temperaturbereich:</span>
            <span className="text-foreground">{minC}°C – {maxC}°C</span>
          </div>
        </div>

        {/* Color gradient */}
        <div className="mt-2.5 h-2 w-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 via-green-500 via-yellow-400 via-orange-500 to-red-500" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>-13°C</span>
          <span>47°C</span>
        </div>

        {/* Tooltip note */}
        <div className="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground/70 leading-relaxed">
          Aggregierte Sommerwärme (nicht Einzelaufnahme).
        </div>
      </div>
    );
  }

  return null;
}

export default EcostressCompositeOverlay;
