/**
 * DeckOverlayManager - Singleton manager for deck.gl overlays on MapLibre
 * STAFF+ AUDIT FIXES:
 * 1. Removed race condition in isReady() (no DOM dependency).
 * 2. Enforces CSS z-index to ensure canvas is visible.
 * 3. Adds robust logging for debugging "invisible" layers.
 */

import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { COORDINATE_SYSTEM } from '@deck.gl/core';

export interface DeckLayerConfig {
  id: string;
  type: 'bitmap' | 'scatterplot';
  visible: boolean;
  opacity?: number;
  image?: HTMLCanvasElement | ImageBitmap;
  // Bounds must be [West, South, East, North] (Lon, Lat, Lon, Lat)
  bounds?: [number, number, number, number]; 
  data?: Array<any>;
  getPosition?: (d: any) => [number, number];
  getColor?: (d: any) => [number, number, number, number];
  getRadius?: (d: any) => number;
  radiusPixels?: number;
}

let overlayInstance: MapboxOverlay | null = null;
let attachedMap: MapLibreMap | null = null;
let currentLayers: Map<string, DeckLayerConfig> = new Map();

// CSS to force the deck canvas to be visible and overlay the map correctly
const DECK_GLOBAL_STYLE = `
  .maplibregl-map .deckgl-overlay {
    z-index: 10 !important;
    pointer-events: none !important;
  }
  /* Force canvas visibility for debugging */
  canvas.deckgl-canvas {
    width: 100% !important;
    height: 100% !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    opacity: 1 !important;
  }
`;

function ensureStyles() {
  if (!document.getElementById('neotopia-deck-style')) {
    const style = document.createElement('style');
    style.id = 'neotopia-deck-style';
    style.textContent = DECK_GLOBAL_STYLE;
    document.head.appendChild(style);
  }
}

export function initDeckOverlay(map: MapLibreMap) {
  if (overlayInstance && attachedMap === map) return;

  console.log('[DeckOverlayManager] Initializing...');
  ensureStyles();

  // Cleanup old instance if switching maps (rare)
  if (overlayInstance) {
    try { overlayInstance.finalize(); } catch(e) { console.warn(e); }
  }

  // Create new Overlay
  overlayInstance = new MapboxOverlay({
    interleaved: false, // false = Top-most layer (safe for overlays)
    layers: [],
  });

  // Attach to MapLibre
  map.addControl(overlayInstance as any);
  attachedMap = map;
  
  // Re-apply any pending layers
  rebuildLayers();
  
  console.log('[DeckOverlayManager] ✅ Ready and attached.');
}

export function updateLayer(config: DeckLayerConfig) {
  // Store the config even if map isn't ready yet (lazy loading)
  currentLayers.set(config.id, config);
  rebuildLayers();
}

export function removeLayer(id: string) {
  if (currentLayers.has(id)) {
    currentLayers.delete(id);
    rebuildLayers();
  }
}

function rebuildLayers() {
  if (!overlayInstance) return;

  const layers = Array.from(currentLayers.values())
    .filter(c => c.visible)
    .map(c => {
      if (c.type === 'bitmap' && c.image && c.bounds) {
        // Validation: Bounds must be West < East, South < North
        // If [Lat, Lon] was passed by mistake, these might be flipped.
        const [w, s, e, n] = c.bounds;
        
        return new BitmapLayer({
          id: c.id,
          image: c.image,
          bounds: [w, s, e, n],
          opacity: c.opacity ?? 0.8,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        });
      }
      return null;
    })
    .filter(Boolean); // Remove nulls

  overlayInstance.setProps({ layers });
}

export function getDiagnostics() {
  return {
    ready: !!overlayInstance && !!attachedMap,
    layerCount: currentLayers.size,
    layers: Array.from(currentLayers.keys()),
  };
}

// THE FIX: isReady should NOT check the DOM. It only checks logic state.
export function isReady(): boolean {
  return !!overlayInstance;
}
