/**
 * ECOSTRESS Summer Composite Overlay
 * 
 * Renders a single, stable heat map from aggregated ECOSTRESS data.
 * Uses quality-weighted pixel aggregation with regional percentile normalization.
 * 
 * ARCHITECTURE FIX (2026-01):
 * - Uses refs to persist image data across re-renders
 * - Separates composite creation from overlay mounting
 * - Prevents state resets during React render cycles
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer, ScatterplotLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { 
  createComposite, 
  type AggregationMethod,
  type CompositeResult,
  type CoverageConfidence,
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

/**
 * Convert ImageData to Canvas for BitmapLayer (more reliable than data URLs).
 * Validates that the canvas is non-empty before returning.
 */
function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[ECOSTRESS] Failed to get canvas 2D context');
  ctx.putImageData(imageData, 0, 0);
  
  // Verify canvas dimensions are valid
  if (canvas.width === 0 || canvas.height === 0) {
    throw new Error(`[ECOSTRESS] Canvas has zero dimensions: ${canvas.width}x${canvas.height}`);
  }
  
  return canvas;
}

/**
 * Validate BitmapLayer bounds format.
 * deck.gl BitmapLayer expects: [west, south, east, north] (minLon, minLat, maxLon, maxLat)
 * This is the same as GeoJSON bbox order: [minX, minY, maxX, maxY]
 */
function assertBitmapLayerBounds(bounds: [number, number, number, number], label: string = 'bounds') {
  const [west, south, east, north] = bounds;
  
  // Assert array format
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    throw new Error(`[ECOSTRESS] ${label} must be [west, south, east, north] array, got: ${JSON.stringify(bounds)}`);
  }
  
  // Assert all values are finite numbers
  if (![west, south, east, north].every((v) => Number.isFinite(v))) {
    throw new Error(`[ECOSTRESS] ${label} contains non-finite values: [${west}, ${south}, ${east}, ${north}]`);
  }
  
  // Assert WGS84 range
  if (west < -180 || east > 180) {
    throw new Error(`[ECOSTRESS] ${label} longitude out of range [-180, 180]: west=${west}, east=${east}`);
  }
  if (south < -90 || north > 90) {
    throw new Error(`[ECOSTRESS] ${label} latitude out of range [-90, 90]: south=${south}, north=${north}`);
  }
  
  // Assert west < east and south < north (non-inverted)
  if (west >= east) {
    throw new Error(`[ECOSTRESS] ${label} inverted longitude: west=${west} >= east=${east}`);
  }
  if (south >= north) {
    throw new Error(`[ECOSTRESS] ${label} inverted latitude: south=${south} >= north=${north}`);
  }
  
  // Log validated bounds in standard format
  console.log(`[ECOSTRESS] ✓ ${label} validated: [W=${west.toFixed(4)}, S=${south.toFixed(4)}, E=${east.toFixed(4)}, N=${north.toFixed(4)}]`);
}

/**
 * Count non-transparent pixels by sampling (fast validation).
 * Throws if canvas appears completely transparent.
 */
function countOpaquePixels(imageData: ImageData, sampleStep = 16): { total: number; opaque: number; ratio: number } {
  const { data, width, height } = imageData;
  let opaque = 0;
  let total = 0;
  
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      total++;
      if (alpha > 0) opaque++;
    }
  }
  
  return { total, opaque, ratio: total > 0 ? opaque / total : 0 };
}

function assertNonEmptyCanvas(imageData: ImageData, sampleStep = 16) {
  const stats = countOpaquePixels(imageData, sampleStep);
  
  console.log(`[ECOSTRESS] Canvas pixel check: ${stats.opaque}/${stats.total} sampled pixels opaque (${(stats.ratio * 100).toFixed(1)}%)`);
  
  if (stats.opaque === 0) {
    throw new Error(`[ECOSTRESS] Canvas is fully transparent! Sampled ${stats.total} pixels, all have alpha=0`);
  }
  
  return stats;
}

function bboxIntersects(a: [number, number, number, number], b: [number, number, number, number]) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
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
  // === REFS for persistence across re-renders ===
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const compositeDataRef = useRef<{
    result: CompositeResult | null;
    imageCanvas: HTMLCanvasElement | null;
    granuleKey: string;
    bboxKey: string;
    method: AggregationMethod;
  }>({ result: null, imageCanvas: null, granuleKey: '', bboxKey: '', method: 'median' });
  const isMountedRef = useRef(true);
  
  // === STATE for UI only ===
  const [status, setStatus] = useState<'idle' | 'loading' | 'rendered' | 'error' | 'no_data'>('idle');
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [displayStats, setDisplayStats] = useState<CompositeResult['stats'] | null>(null);
  const [displayMetadata, setDisplayMetadata] = useState<CompositeResult['metadata'] | null>(null);
  
  // Stabilize callback refs
  const onRenderStatusRef = useRef(onRenderStatus);
  const onMetadataRef = useRef(onMetadata);
  onRenderStatusRef.current = onRenderStatus;
  onMetadataRef.current = onMetadata;
  
  // Stabilize granule list by tracking count and first granule ID
  const granuleKey = allGranules 
    ? `${allGranules.length}-${allGranules[0]?.granule_id || 'none'}`
    : 'none';
  
  // Stabilize bbox by converting to string key
  const bboxKey = regionBbox ? regionBbox.join(',') : 'none';

  // === MOUNT OVERLAY onto map ===
  const mountOverlay = useCallback(() => {
    if (!map || !compositeDataRef.current.imageCanvas || !compositeDataRef.current.result) {
      console.log('[EcostressCompositeOverlay] Cannot mount: missing map or data');
      return false;
    }
    
    // Remove existing overlay first
    if (overlayRef.current) {
      try {
        map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
      } catch (e) {
        // Ignore
      }
      overlayRef.current = null;
    }

    if (!map.getCanvas()) {
      console.warn('[EcostressCompositeOverlay] Map canvas not ready');
      return false;
    }

    const { result, imageCanvas } = compositeDataRef.current;
    const debug = import.meta.env.DEV;
    const effectiveOpacity = debug ? 1 : opacity;

    // ═══════════════════════════════════════════════════════════════════════════
    // HARD ASSERTIONS — fail fast, never silently render nothing
    // ═══════════════════════════════════════════════════════════════════════════
    
    // 1. Validate BitmapLayer bounds format: [west, south, east, north]
    assertBitmapLayerBounds(result.bounds, 'BitmapLayer bounds');
    
    // 2. Validate canvas has non-transparent pixels
    const pixelStats = assertNonEmptyCanvas(result.imageData, 16);
    
    // 3. Validate canvas dimensions match ImageData
    if (imageCanvas.width !== result.imageData.width || imageCanvas.height !== result.imageData.height) {
      throw new Error(`[ECOSTRESS] Canvas size mismatch: canvas=${imageCanvas.width}x${imageCanvas.height}, imageData=${result.imageData.width}x${result.imageData.height}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // View state validation — verify data intersects viewport
    // ═══════════════════════════════════════════════════════════════════════════
    try {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const mb = map.getBounds();
      const viewBbox: [number, number, number, number] = [mb.getWest(), mb.getSouth(), mb.getEast(), mb.getNorth()];
      const intersects = bboxIntersects(viewBbox, result.bounds);
      
      console.log('[EcostressCompositeOverlay] Viewport vs Data bounds:');
      console.log(`  View:    [W=${viewBbox[0].toFixed(4)}, S=${viewBbox[1].toFixed(4)}, E=${viewBbox[2].toFixed(4)}, N=${viewBbox[3].toFixed(4)}] @ zoom ${zoom.toFixed(1)}`);
      console.log(`  Data:    [W=${result.bounds[0].toFixed(4)}, S=${result.bounds[1].toFixed(4)}, E=${result.bounds[2].toFixed(4)}, N=${result.bounds[3].toFixed(4)}]`);
      console.log(`  Intersects: ${intersects ? '✅ YES' : '⚠️ NO (data outside viewport!)'}`);
      console.log(`  Canvas: ${imageCanvas.width}x${imageCanvas.height}, ${pixelStats.opaque} opaque pixels`);
      
      if (!intersects) {
        console.warn('[EcostressCompositeOverlay] ⚠️ Data bounds do NOT intersect viewport — layer may not be visible at current zoom/pan!');
      }
    } catch {
      // ignore view state errors
    }
    
    console.log('[EcostressCompositeOverlay] Creating BitmapLayer with:', {
      boundsFormat: '[west, south, east, north]',
      bounds: result.bounds,
      opacity: effectiveOpacity,
      imageType: 'HTMLCanvasElement',
      imageSize: `${imageCanvas.width}x${imageCanvas.height}`,
      coordinateSystem: 'COORDINATE_SYSTEM.LNGLAT',
    });

    try {
      const layer = new BitmapLayer({
        id: 'ecostress-summer-composite',
        bounds: result.bounds,
        image: imageCanvas,
        opacity: effectiveOpacity,
        visible: true,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        parameters: { depthTest: false },
      });

      // Force-visual debug: draw bright red corner + centroid points so CRS/bounds issues can’t hide.
      const debugLayers = import.meta.env.DEV
        ? [
            new ScatterplotLayer({
              id: 'ecostress-debug-points',
              data: (() => {
                const [w, s, e, n] = result.bounds;
                const c: [number, number] = [(w + e) / 2, (s + n) / 2];
                console.log('[EcostressCompositeOverlay] Creating debug points at:', {
                  SW: [w.toFixed(4), s.toFixed(4)],
                  NW: [w.toFixed(4), n.toFixed(4)],
                  NE: [e.toFixed(4), n.toFixed(4)],
                  SE: [e.toFixed(4), s.toFixed(4)],
                  CENTER: [c[0].toFixed(4), c[1].toFixed(4)],
                });
                return [
                  { p: [w, s] as [number, number], n: 'SW' },
                  { p: [w, n] as [number, number], n: 'NW' },
                  { p: [e, n] as [number, number], n: 'NE' },
                  { p: [e, s] as [number, number], n: 'SE' },
                  { p: c, n: 'C' },
                ];
              })(),
              getPosition: (d: { p: [number, number] }) => d.p,
              getFillColor: [255, 0, 0, 255], // Pure red, full alpha
              getRadius: 50, // VERY LARGE for debugging visibility
              radiusUnits: 'pixels',
              opacity: 1,
              visible: true,
              pickable: true,
              coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
              parameters: { depthTest: false },
            }),
          ]
        : [];

      const overlay = new MapboxOverlay({
        interleaved: false,
        layers: [layer, ...debugLayers],
      });

      map.addControl(overlay as unknown as maplibregl.IControl);
      overlayRef.current = overlay;
      
      console.log('[EcostressCompositeOverlay] ✅ Overlay mounted successfully with', debugLayers.length > 0 ? 'debug corners' : 'no debug');

      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: Verify deck.gl canvas is correctly sized
      // A 300x150 canvas indicates the overlay didn't inherit map dimensions
      // ═══════════════════════════════════════════════════════════════════════════
      if (import.meta.env.DEV) {
        setTimeout(() => {
          const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
          const deckCanvas = canvases.find((c) => {
            const id = (c.id || '').toLowerCase();
            const cls = String(c.className || '').toLowerCase();
            return id.includes('deck') || cls.includes('deck') || cls.includes('deckgl');
          });
          
          if (deckCanvas) {
            const mapCanvas = map.getCanvas();
            const expectedWidth = mapCanvas?.width || 0;
            const expectedHeight = mapCanvas?.height || 0;
            const style = window.getComputedStyle(deckCanvas);
            
            const isDefaultSize = deckCanvas.width === 300 && deckCanvas.height === 150;
            const sizeMismatch = deckCanvas.width !== expectedWidth || deckCanvas.height !== expectedHeight;
            
            console.log('[EcostressCompositeOverlay] Deck.gl canvas audit:', {
              id: deckCanvas.id || '(none)',
              deckSize: `${deckCanvas.width}x${deckCanvas.height}`,
              mapSize: `${expectedWidth}x${expectedHeight}`,
              isDefaultSize: isDefaultSize ? '⚠️ YES (BAD)' : '✅ NO',
              sizeMismatch: sizeMismatch ? '⚠️ YES' : '✅ NO',
              display: style.display,
              visibility: style.visibility,
              zIndex: style.zIndex,
            });
            
            // If canvas has default dimensions, try to force a resize
            if (isDefaultSize || sizeMismatch) {
              console.warn('[EcostressCompositeOverlay] ⚠️ Deck canvas has wrong size — triggering resize...');
              // Trigger map resize which should propagate to deck overlay
              map.resize();
              // Also try forcing deck overlay to redraw
              if (overlayRef.current) {
                overlayRef.current.setProps({ layers: [layer, ...debugLayers] });
              }
            }
          } else {
            console.error('[EcostressCompositeOverlay] ❌ Deck.gl canvas NOT FOUND in DOM!');
          }
        }, 150);
      }
      
      return true;
    } catch (err) {
      console.error('[EcostressCompositeOverlay] ❌ Failed to mount overlay:', err);
      return false;
    }
  }, [map, opacity]);

  // === REMOVE OVERLAY from map ===
  const removeOverlay = useCallback(() => {
    if (overlayRef.current && map) {
      try {
        map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
        console.log('[EcostressCompositeOverlay] Overlay removed');
      } catch (e) {
        // Ignore cleanup errors
      }
      overlayRef.current = null;
    }
  }, [map]);

  // === CREATE COMPOSITE when granules change ===
  useEffect(() => {
    // Mark component as mounted
    isMountedRef.current = true;
    
    if (!visible || !allGranules || allGranules.length === 0 || !regionBbox) {
      // Not visible or no data - just update status, DON'T clear the cached data
      if (!visible) {
        setStatus('idle');
      }
      return;
    }

    // Check if we already have this composite cached
    const forceNoCache = import.meta.env.DEV;
    const needsRefresh =
      forceNoCache ||
      compositeDataRef.current.granuleKey !== granuleKey ||
      compositeDataRef.current.bboxKey !== bboxKey ||
      compositeDataRef.current.method !== aggregationMethod;

     if (!needsRefresh && compositeDataRef.current.result) {
      console.log('[EcostressCompositeOverlay] Using cached composite');
      setStatus('rendered');
      setDisplayStats(compositeDataRef.current.result.stats);
      setDisplayMetadata(compositeDataRef.current.result.metadata);
      return;
    }

    // Build new composite
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
            if (!cancelled && isMountedRef.current) {
              setProgress({ loaded, total });
            }
          }
        );

        if (cancelled || !isMountedRef.current) return;

        if (!result) {
          setStatus('no_data');
          onRenderStatusRef.current?.('no_data', 'Keine gültigen Daten für Komposit nach Qualitätsfilterung');
          onMetadataRef.current?.(null);
          return;
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // Validate composite result before storing
        // ═══════════════════════════════════════════════════════════════════════════
        
        // 1. Validate bounds format
        assertBitmapLayerBounds(result.bounds, 'Composite result bounds');
        
        // 2. Validate canvas has visible pixels
        const pixelStats = assertNonEmptyCanvas(result.imageData, 16);
        console.log(`[EcostressCompositeOverlay] Composite validated: ${pixelStats.opaque}/${pixelStats.total} sampled pixels opaque`);
        
        // 3. Convert to Canvas (more reliable than data URL)
        const canvas = imageDataToCanvas(result.imageData);
        
        // Store in ref to persist across re-renders
        compositeDataRef.current = {
          result,
          imageCanvas: canvas,
          granuleKey,
          bboxKey,
          method: aggregationMethod,
        };

        // Update UI state
        setStatus('rendered');
        setDisplayStats(result.stats);
        setDisplayMetadata(result.metadata);
        setProgress(null);

        // Build metadata for callback
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

        console.log('[EcostressCompositeOverlay] Composite created and cached:', {
          granules: result.stats.successfulGranules,
          pixels: result.stats.validPixels,
          coverage: `${result.metadata.coverageConfidence.percent}%`,
        });

      } catch (err) {
        if (cancelled || !isMountedRef.current) return;
        console.error('[EcostressCompositeOverlay] Failed to create composite:', err);
        setStatus('error');
        onRenderStatusRef.current?.('error', err instanceof Error ? err.message : 'Unbekannter Fehler');
      } finally {
        if (isMountedRef.current) {
          setProgress(null);
        }
      }
    }

    buildComposite();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, granuleKey, bboxKey, aggregationMethod]);

  // === MANAGE OVERLAY LIFECYCLE ===
   useEffect(() => {
    if (!map) return;

    // Handle style load (basemap changes)
    const handleStyleLoad = () => {
      // Re-mount overlay after style change if we have data and should be visible
      if (visible && compositeDataRef.current.imageCanvas) {
        setTimeout(() => {
          mountOverlay();
        }, 150); // Delay to ensure style is fully loaded
      }
    };

    // Initial mount or visibility change
    if (visible && compositeDataRef.current.imageCanvas) {
      if (map.isStyleLoaded()) {
        mountOverlay();
      }
    } else if (!visible) {
      removeOverlay();
    }

    // Listen for style changes (basemap switches)
    map.on('style.load', handleStyleLoad);

    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [map, visible, mountOverlay, removeOverlay]);

  // === UPDATE OPACITY without re-creating overlay ===
  useEffect(() => {
    if (!overlayRef.current || !compositeDataRef.current.result || !compositeDataRef.current.imageCanvas) return;

    const debug = import.meta.env.DEV;
    const effectiveOpacity = debug ? 1 : opacity;

    const layer = new BitmapLayer({
      id: 'ecostress-summer-composite',
      bounds: compositeDataRef.current.result.bounds,
      image: compositeDataRef.current.imageCanvas,
      opacity: effectiveOpacity,
      visible: true,
      pickable: true,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      parameters: { depthTest: false },
    });

    // Keep debug points in dev on opacity updates too
    const debugLayers = import.meta.env.DEV
      ? [
          new ScatterplotLayer({
            id: 'ecostress-debug-points',
            data: (() => {
              const [w, s, e, n] = compositeDataRef.current.result!.bounds;
              const c: [number, number] = [(w + e) / 2, (s + n) / 2];
              return [
                { p: [w, s] as [number, number], n: 'SW' },
                { p: [w, n] as [number, number], n: 'NW' },
                { p: [e, n] as [number, number], n: 'NE' },
                { p: [e, s] as [number, number], n: 'SE' },
                { p: c, n: 'C' },
              ];
            })(),
            getPosition: (d: { p: [number, number] }) => d.p,
            getFillColor: [255, 0, 0, 255],
            getRadius: 50, // Match mountOverlay debug radius
            radiusUnits: 'pixels',
            opacity: 1,
            visible: true,
            pickable: true,
            coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            parameters: { depthTest: false },
          }),
        ]
      : [];

    overlayRef.current.setProps({ layers: [layer, ...debugLayers] });
  }, [opacity]);

  // === CLEANUP on unmount ===
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      removeOverlay();
    };
  }, [removeOverlay]);

  // === TRIGGER MOUNT when data becomes available ===
  useEffect(() => {
    if (visible && status === 'rendered' && compositeDataRef.current.imageCanvas && map) {
      // Ensure overlay is mounted after composite is ready
      if (!overlayRef.current && map.isStyleLoaded()) {
        mountOverlay();
      }
    }
  }, [visible, status, map, mountOverlay]);

  // === RENDER UI ===
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

  if (status === 'rendered' && displayStats && displayMetadata) {
    const minC = (displayStats.min - 273.15).toFixed(1);
    const maxC = (displayStats.max - 273.15).toFixed(1);
    const p5C = (displayStats.p5 - 273.15).toFixed(1);
    const p95C = (displayStats.p95 - 273.15).toFixed(1);
    const methodLabel = displayStats.aggregationMethod === 'max' ? 'Maximum (Heißeste)' 
      : displayStats.aggregationMethod === 'p90' ? 'P90 (Extreme)' : 'Median';
    const confidence = displayMetadata.coverageConfidence;
    
    const fromDate = displayMetadata.timeWindow.from 
      ? new Date(displayMetadata.timeWindow.from).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
      : '';
    const toDate = displayMetadata.timeWindow.to
      ? new Date(displayMetadata.timeWindow.to).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
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
              {displayStats.successfulGranules}
              {displayStats.discardedGranules > 0 && (
                <span className="text-muted-foreground"> (−{displayStats.discardedGranules} verworfen)</span>
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
