import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer } from '@deck.gl/layers';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { COORDINATE_SYSTEM } from '@deck.gl/core';

export interface DeckLayerConfig {
  id: string;
  type: 'bitmap' | 'scatterplot';
  visible: boolean;
  opacity?: number;
  // HIER: ImageBitmap explizit erlaubt
  image?: HTMLCanvasElement | ImageBitmap;
  bounds?: [number, number, number, number];
  data?: any[];
}

let overlayInstance: MapboxOverlay | null = null;
let attachedMap: MapLibreMap | null = null;
let currentLayers: Map<string, DeckLayerConfig> = new Map();

function injectCSS() {
  if (typeof document === 'undefined') return;
  const id = 'deck-force-visible';
  if (!document.getElementById(id)) {
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .maplibregl-map canvas.deckgl-canvas {
        z-index: 5 !important;
        pointer-events: none !important;
        opacity: 1 !important;
      }
    `;
    document.head.appendChild(s);
  }
}

export function initDeckOverlay(map: MapLibreMap, force = false) {
  if (overlayInstance && attachedMap === map && !force) return;

  injectCSS();
  
  // Cleanup old if exists
  if (overlayInstance) {
    try { overlayInstance.finalize(); } catch(e) {}
  }

  // Create new
  overlayInstance = new MapboxOverlay({
    interleaved: false,
    layers: []
  });

  // Attach
  map.addControl(overlayInstance as any);
  attachedMap = map;
  
  rebuildLayers();
  console.log('[DeckOverlayManager] Initialized');
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
    .filter(l => l.visible)
    .map(c => {
      if (c.type === 'bitmap' && c.image && c.bounds) {
        return new BitmapLayer({
          id: c.id,
          image: c.image,
          bounds: c.bounds,
          opacity: c.opacity ?? 0.8,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          // Optimization for bitmaps
          parameters: {
            depthTest: false,
            blend: true
          }
        });
      }
      return null;
    })
    .filter(Boolean);

  overlayInstance.setProps({ layers });
}

export function finalizeDeckOverlay() {
  if (overlayInstance) overlayInstance.finalize();
  overlayInstance = null;
  attachedMap = null;
  currentLayers.clear();
}

export function isReady(): boolean {
  return !!overlayInstance;
}
