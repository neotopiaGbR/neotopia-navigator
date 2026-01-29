/**
 * DeckOverlayManager - Singleton manager for deck.gl overlays on MapLibre
 * * CRITICAL ARCHITECTURE RULES:
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
  if (!container) return null;
  return container.querySelector(DECK_CANVAS_SELECTOR) as HTMLCanvasElement | null;
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
  
  // If we are switching maps, we drop old layers. 
  // If we are just re-initializing on same map (style change), preserve them.
  const preservedLayers = switchingMap ? new Map<string, DeckLayerConfig>() : new Map(currentLayers);
  
  if (!force && attachedMap === map && overlayInstance) {
    console.log('[DeckOverlayManager] Already initialized for this map');
    return;
  }
  
  // Clean up previous instance
  if (overlayInstance) {
    try {
      if (attachedMap) {
        // MapboxOverlay doesn't have a clean "remove" when manually added, 
        // but checking the control removal just in case.
        // We generally rely on finalizer or replacing the instance.
      }
      (overlayInstance as any)?.finalize?.();
    } catch (e) {
      console.warn('[DeckOverlayManager] Failed to remove previous overlay:', e);
    }
    overlayInstance = null;
  }
  
  // Create new overlay
  // interleaved: false is crucial for stable z-ordering on top of map
  overlayInstance = new MapboxOverlay({
    interleaved: false,
    layers: [],
  });
  
  // Attach to map manually to ensure correct DOM placement
  const container = map.getCanvasContainer();
  const overlayElement = overlayInstance.onAdd(map as any);
  container.appendChild(overlayElement);
  attachedMap = map;

  // Restore layers
  currentLayers = preservedLayers;
  
  // Ensure CSS is correct
  enforceDeckCSS();

  // Immediately rebuild to show preserved layers
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

  if (deckCssObserver) {
    try {
      deckCssObserver.disconnect();
    } catch { /* ignore */ }
    deckCssObserver = null;
  }

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

  // Apply immediately and watch for changes (MapLibre might re-insert canvas)
  applyInlineStyles();

  deckCssObserver = new MutationObserver(applyInlineStyles);
  deckCssObserver.observe(container, { childList: true, subtree: true });
}

/**
 * Add render proof layers (dev mode only)
 */
function addRenderProof(): void {
  if (!attachedMap) return;
  const center = attachedMap.getCenter();
  
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
}

/**
 * Update or add a layer
 */
export function updateLayer(config: DeckLayerConfig): void {
  if (!overlayInstance) {
    // If called before init, we can't do much. Components should wait for mapReady.
    // However, we log a warning instead of error to reduce noise during unmounts.
    console.warn('[DeckOverlayManager] Update called before init:', config.id);
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
  
  if (currentLayers.has(id)) {
    currentLayers.delete(id);
    rebuildLayers();
  }
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
      // Basic sanity check
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
  
  // Update overlay via setProps
  // This will create the canvas if it doesn't exist yet
  overlayInstance.setProps({ layers });
  
  // Dev logging
  if (isDevMode) {
    // console.log('[DeckOverlayManager] Layers updated:', layers.map((l) => l.id));
  }
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
} {
  const canvas = getDeckCanvas();
  const rect = canvas ? canvas.getBoundingClientRect() : null;
  
  return {
    initialized: !!overlayInstance && !!attachedMap,
    layerCount: currentLayers.size,
    layerIds: Array.from(currentLayers.keys()),
    canvasExists: !!canvas,
    canvasDimensions: canvas ? { width: canvas.width, height: canvas.height } : null,
    canvasCssDimensions: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
  };
}

/**
 * Check if overlay is ready for interaction
 * FIX: Do NOT check for DOM canvas presence here. 
 * If the instance exists, we are ready to accept layers.
 */
export function isReady(): boolean {
  return !!overlayInstance && !!attachedMap;
}

/**
 * Get the attached map
 */
export function getAttachedMap(): MapLibreMap | null {
  return attachedMap;
}

/**
 * Finalize and cleanup
 */
export function finalizeDeckOverlay(): void {
  if (overlayInstance) {
    try {
      overlayInstance.setProps({ layers: [] });
      overlayInstance.finalize();
    } catch (e) {
      // ignore
    }
  }
  overlayInstance = null;
  attachedMap = null;
  currentLayers.clear();

  if (deckCssObserver) {
    try {
      deckCssObserver.disconnect();
    } catch { /* ignore */ }
    deckCssObserver = null;
  }

  console.log('[DeckOverlayManager] Finalized');
}
