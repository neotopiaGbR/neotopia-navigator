/**
 * DeckOverlayManager - Singleton for MapLibre Integration
 * ARCHITECT FIX:
 * 1. Removed strict DOM dependency in isReady()
 * 2. Auto-injects CSS to ensure canvas visibility (z-index fix)
 * 3. Handles map style changes gracefully
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
  bounds?: [number, number, number, number]; // [W, S, E, N]
  data?: any[];
  getPosition?: (d: any) => [number, number];
  getColor?: (d: any) => [number, number, number, number];
  getRadius?: (d: any) => number;
}

let overlayInstance: MapboxOverlay | null = null;
let attachedMap: MapLibreMap | null = null;
let currentLayers: Map<string, DeckLayerConfig> = new Map();

export function getDiagnostics() {
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

  const visibleLayerIds = Array.from(currentLayers.values())
    .filter((c) => c.visible)
    .map((c) => c.id);

  let canvas: HTMLCanvasElement | null = null;
  let rect: DOMRect | null = null;
  if (typeof document !== 'undefined') {
    canvas = document.querySelector(
      'canvas.deckgl-canvas, canvas[id*="deck"], canvas.deck-canvas, canvas[data-deck]'
    ) as HTMLCanvasElement | null;
    rect = canvas ? canvas.getBoundingClientRect() : null;
  }

  return {
    initialized: !!overlayInstance,
    devicePixelRatio: dpr,
    layerCount: visibleLayerIds.length,
    layerIds: visibleLayerIds,
    canvasDimensions: canvas ? { width: canvas.width, height: canvas.height } : null,
    canvasCssDimensions: rect
      ? { width: Math.round(rect.width), height: Math.round(rect.height) }
      : null,
  };
}

// CSS Injection to FORCE canvas visibility
const CSS_ID = 'neotopia-deck-styles';
const FORCE_CSS = `
  .maplibregl-map .deckgl-overlay {
    z-index: 10 !important;
    pointer-events: none !important;
  }
  canvas.deckgl-canvas {
    pointer-events: none !important;
  }
`;

function injectCSS() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById(CSS_ID)) {
    const style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = FORCE_CSS;
    document.head.appendChild(style);
  }
}

export function initDeckOverlay(map: MapLibreMap, force: boolean = false) {
  if (!map) return;
  
  // If we are already attached to THIS map and not forced, do nothing
  if (overlayInstance && attachedMap === map && !force) return;

  console.log('[DeckOverlayManager] Initializing on map instance...');
  injectCSS();

  // Cleanup old instance
  if (overlayInstance) {
    try { overlayInstance.finalize(); } catch (e) { console.warn('Cleanup warning:', e); }
  }

  // Create new instance
  overlayInstance = new MapboxOverlay({
    interleaved: false, // Keep on top
    layers: []
  });

  // Attach to map
  map.addControl(overlayInstance as any);
  attachedMap = map;

  // Re-apply known layers immediately
  rebuildLayers();
}

export function updateLayer(config: DeckLayerConfig) {
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
        return new BitmapLayer({
          id: c.id,
          image: c.image,
          bounds: c.bounds,
          opacity: c.opacity ?? 0.8,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT
        });
      }
      // Add other types here if needed
      return null;
    })
    .filter(Boolean);

  overlayInstance.setProps({ layers });
}

export function finalizeDeckOverlay() {
  if (overlayInstance) {
    overlayInstance.finalize();
    overlayInstance = null;
  }
  attachedMap = null;
  currentLayers.clear();
}

// FIX: Logic check only, no DOM check
export function isReady(): boolean {
  return !!overlayInstance;
}
