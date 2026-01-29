/**
 * DeckOverlayManager - Singleton manager for deck.gl overlays on MapLibre
 * 
 * CRITICAL ARCHITECTURE RULES:
 * 1. EXACTLY ONE MapboxOverlay instance attached to the map at any time
 * 2. All layer updates via setProps({ layers }) - never recreate overlay
 * 3. Canvas CSS: 100% width/height, z-index above map, pointer-events: none
 * 4. coordinateSystem: LNGLAT for all layers, bounds in WGS84 [west, south, east, north]
 * 5. BitmapLayer.image: HTMLCanvasElement or ImageBitmap - NEVER DataURL strings
 */

import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Map as MapLibreMap, IControl } from 'maplibre-gl';
import { COORDINATE_SYSTEM } from '@deck.gl/core';

const DECK_CANVAS_SELECTOR =
  'canvas.deckgl-canvas, canvas[id*="deck"], canvas.deck-canvas, canvas[data-deck], canvas.deck-canvas';

const DECK_STYLE_ID = 'neotopia-deck-overlay-css';

let deckCssObserver: MutationObserver | null = null;

export interface DeckLayerConfig {
  id: string;
  type: 'bitmap' | 'scatterplot';
  visible: boolean;
  opacity?: number;
  // For bitmap layers
  image?: HTMLCanvasElement | ImageBitmap;
  bounds?: [number, number, number, number]; // [west, south, east, north] WGS84
  // For scatterplot layers
  data?: Array<{ position: [number, number]; color?: [number, number, number, number]; radius?: number }>;
  getPosition?: (d: any) => [number, number];
  getColor?: (d: any) => [number, number, number, number];
  getRadius?: (d: any) => number;
  radiusPixels?: number;
}

// Singleton state
let overlayInstance: MapboxOverlay | null = null;
let attachedMap: MapLibreMap | null = null;
let currentLayers: Map<string, DeckLayerConfig> = new Map();
let isDevMode = false;

function getDeckCanvas(): HTMLCanvasElement | null {
  const container = attachedMap?.getContainer?.() as HTMLElement | undefined;
  const scope: ParentNode = container ?? document;
  return scope.querySelector(DECK_CANVAS_SELECTOR) as HTMLCanvasElement | null;
}

function ensureGlobalDeckStyle(): void {
  if (document.getElementById(DECK_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = DECK_STYLE_ID;
  style.textContent = `
    .maplibregl-map .deckgl-overlay,
    .mapboxgl-map .deckgl-overlay {
      position: absolute !important;
      inset: 0 !important;
      z-index: 10 !important;
      pointer-events: none !important;
    }

    .maplibregl-map .deckgl-overlay canvas,
    .mapboxgl-map .deckgl-overlay canvas,
    .maplibregl-map canvas.deckgl-canvas,
    .mapboxgl-map canvas.deckgl-canvas,
    .maplibregl-map canvas[id*="deck"],
    .mapboxgl-map canvas[id*="deck"],
    .maplibregl-map canvas.deck-canvas,
    .mapboxgl-map canvas.deck-canvas,
    .maplibregl-map canvas[data-deck],
    .mapboxgl-map canvas[data-deck] {
      width: 100% !important;
      height: 100% !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      z-index: 10 !important;
      pointer-events: none !important;
    }
  `;

  document.head.appendChild(style);
}

/**
 * Initialize the deck.gl overlay manager
 * Call this once when the map is ready
 */
export function initDeckOverlay(
  map: MapLibreMap,
  dev: boolean = false,
  options?: { force?: boolean }
): void {
  isDevMode = dev;

  const force = !!options?.force;
  const switchingMap = !!attachedMap && attachedMap !== map;
  const preservedLayers = switchingMap ? new Map<string, DeckLayerConfig>() : new Map(currentLayers);
  
  if (!force && attachedMap === map && overlayInstance && getDeckCanvas()) {
    console.log('[DeckOverlayManager] Already initialized for this map');
    return;
  }
  
  // Clean up previous instance if switching maps
  if (overlayInstance && attachedMap) {
    try {
      attachedMap.removeControl(overlayInstance as unknown as IControl);
      // Ensure WebGL resources are released
      (overlayInstance as any)?.finalize?.();
    } catch (e) {
      console.warn('[DeckOverlayManager] Failed to remove previous overlay:', e);
    }
    overlayInstance = null;
  }
  
  // Create new overlay with interleaved: false for correct stacking
  overlayInstance = new MapboxOverlay({
    interleaved: false,
    layers: [],
  });
  
  // Attach to map manually (NOT via addControl - that breaks rendering in MapLibre)
  const container = map.getCanvasContainer();
  const overlayElement = overlayInstance.onAdd(map as any);
  container.appendChild(overlayElement);
  attachedMap = map;

  // Preserve existing layers on same-map reinit (e.g. after style.load)
  currentLayers = switchingMap ? new Map() : preservedLayers;
  
  // Ensure CSS is correct
  enforceDeckCSS();

  // Re-apply layers after re-attach
  rebuildLayers();
  
  console.log('[DeckOverlayManager] ✅ Initialized singleton overlay on map');
  
  // Add render proof if in dev mode
  if (isDevMode) {
    addRenderProof();
  }
}

/**
 * Enforce correct CSS for deck.gl canvas
 */
function enforceDeckCSS(): void {
  ensureGlobalDeckStyle();

  // Clean up previous observer to avoid leaks across re-inits
  if (deckCssObserver) {
    try {
      deckCssObserver.disconnect();
    } catch {
      // ignore
    }
    deckCssObserver = null;
  }

  // Use MutationObserver to catch deck canvas when it's created
  const container = attachedMap?.getContainer?.() as HTMLElement | null;
  if (!container) return;

  const applyInlineStyles = () => {
    const canvases = container.querySelectorAll(DECK_CANVAS_SELECTOR);
    canvases.forEach((canvas) => {
      const el = canvas as HTMLCanvasElement;
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.position = 'absolute';
      el.style.top = '0';
      el.style.left = '0';
      el.style.zIndex = '10';
      el.style.pointerEvents = 'none';
    });
  };

  applyInlineStyles();

  deckCssObserver = new MutationObserver(applyInlineStyles);
  deckCssObserver.observe(container, { childList: true, subtree: true });
}

/**
 * Add render proof layers (dev mode only)
 * These MUST be visible if deck.gl is working correctly
 */
function addRenderProof(): void {
  if (!attachedMap) return;
  
  const center = attachedMap.getCenter();
  
  // Magenta dot at map center
  updateLayer({
    id: 'render-proof-center',
    type: 'scatterplot',
    visible: true,
    data: [{ position: [center.lng, center.lat], color: [255, 0, 255, 255], radius: 20 }],
    getPosition: (d) => d.position,
    getColor: (d) => d.color,
    getRadius: (d) => d.radius,
    radiusPixels: 20,
  });
  
  console.log('[DeckOverlayManager] 🟣 Render proof dot added at', center.lng.toFixed(4), center.lat.toFixed(4));
}

/**
 * Update or add a layer
 */
export function updateLayer(config: DeckLayerConfig): void {
  if (!overlayInstance) {
    console.error('[DeckOverlayManager] Not initialized - call initDeckOverlay first');
    return;
  }
  
  currentLayers.set(config.id, config);
  rebuildLayers();
}

/**
 * Remove a layer by ID
 */
export function removeLayer(id: string): void {
  if (!overlayInstance) return;
  
  currentLayers.delete(id);
  rebuildLayers();
}

/**
 * Remove all layers (except render proof in dev mode)
 */
export function clearLayers(): void {
  if (!overlayInstance) return;
  
  const keysToRemove = Array.from(currentLayers.keys()).filter(
    (k) => !isDevMode || !k.startsWith('render-proof')
  );
  keysToRemove.forEach((k) => currentLayers.delete(k));
  rebuildLayers();
}

/**
 * Rebuild and update all layers
 */
function rebuildLayers(): void {
  if (!overlayInstance) return;
  
  const layers: Array<BitmapLayer | ScatterplotLayer> = [];
  
  currentLayers.forEach((config) => {
    if (!config.visible) return;
    
    if (config.type === 'bitmap' && config.image && config.bounds) {
      // Validate bounds are WGS84
      const [west, south, east, north] = config.bounds;
      if (west < -180 || east > 180 || south < -90 || north > 90) {
        console.error(`[DeckOverlayManager] Invalid WGS84 bounds for ${config.id}:`, config.bounds);
        return;
      }
      
      layers.push(
        new BitmapLayer({
          id: config.id,
          image: config.image,
          bounds: config.bounds,
          opacity: config.opacity ?? 0.8,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          pickable: false,
          parameters: { depthTest: false },
        })
      );
    }
    
    if (config.type === 'scatterplot' && config.data) {
      layers.push(
        new ScatterplotLayer({
          id: config.id,
          data: config.data,
          getPosition: config.getPosition ?? ((d) => d.position),
          getColor: config.getColor ?? ((d) => d.color ?? [255, 0, 255, 255]),
          getRadius: config.getRadius ?? ((d) => d.radius ?? 10),
          radiusUnits: 'pixels',
          radiusMinPixels: config.radiusPixels ?? 10,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          pickable: false,
        })
      );
    }
  });
  
  // Update overlay via setProps - NEVER recreate
  overlayInstance.setProps({ layers });
  
  console.log('[DeckOverlayManager] Layers updated:', layers.map((l) => l.id));
}

/**
 * Get diagnostic info for debugging
 */
export function getDiagnostics(): {
  initialized: boolean;
  layerCount: number;
  layerIds: string[];
  canvasExists: boolean;
  canvasDimensions: { width: number; height: number } | null;
  canvasCssDimensions: { width: number; height: number } | null;
  devicePixelRatio: number;
} {
  const canvas = getDeckCanvas();
  const rect = canvas ? canvas.getBoundingClientRect() : null;
  
  return {
    initialized: !!overlayInstance && !!attachedMap && !!canvas,
    layerCount: currentLayers.size,
    layerIds: Array.from(currentLayers.keys()),
    canvasExists: !!canvas,
    canvasDimensions: canvas ? { width: canvas.width, height: canvas.height } : null,
    canvasCssDimensions: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  };
}

/**
 * Finalize and cleanup
 */
export function finalizeDeckOverlay(): void {
  if (overlayInstance && attachedMap) {
    try {
      overlayInstance.setProps({ layers: [] });
      try {
        overlayInstance.onRemove();
      } catch {}
      (overlayInstance as any)?.finalize?.();
    } catch (e) {
      console.warn('[DeckOverlayManager] Cleanup error:', e);
    }
  }
  overlayInstance = null;
  attachedMap = null;
  currentLayers.clear();

  if (deckCssObserver) {
    try {
      deckCssObserver.disconnect();
    } catch {
      // ignore
    }
    deckCssObserver = null;
  }

  console.log('[DeckOverlayManager] Finalized');
}

/**
 * Check if overlay is ready
 */
export function isReady(): boolean {
  return !!overlayInstance && !!attachedMap && !!getDeckCanvas();
}

/**
 * Get the attached map (for components that need map reference)
 */
export function getAttachedMap(): MapLibreMap | null {
  return attachedMap;
}
