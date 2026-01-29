import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer } from '@deck.gl/layers';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { COORDINATE_SYSTEM } from '@deck.gl/core';

export interface DeckLayerConfig {
  id: string;
  type: 'bitmap' | 'scatterplot';
  visible: boolean;
  opacity?: number;
  image?: HTMLCanvasElement | ImageBitmap;
  bounds?: [number, number, number, number];
  data?: any[];
}

let overlayInstance: MapboxOverlay | null = null;
let attachedMap: MapLibreMap | null = null;
let currentLayers: Map<string, DeckLayerConfig> = new Map();

// CSS Injection um Canvas sichtbar zu machen
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
  
  if (overlayInstance) {
    try { overlayInstance.finalize(); } catch(e) {}
  }

  overlayInstance = new MapboxOverlay({
    interleaved: false,
    layers: []
  });

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

export function getAttachedMap() {
  return attachedMap;
}

export function getDiagnostics() {
  const canvas = attachedMap?.getCanvas?.();
  const container = attachedMap?.getContainer?.();
  const deckCanvas = container?.querySelector?.('canvas.deckgl-canvas') as HTMLCanvasElement | null;
  
  return {
    initialized: !!overlayInstance,
    layerCount: currentLayers.size,
    layers: Array.from(currentLayers.keys()),
    // Für OverlayDiagnosticsPanel:
    canvasDimensions: deckCanvas ? { width: deckCanvas.width, height: deckCanvas.height } : null,
    canvasCssDimensions: deckCanvas ? { 
      width: Math.round(deckCanvas.getBoundingClientRect().width), 
      height: Math.round(deckCanvas.getBoundingClientRect().height) 
    } : null,
    devicePixelRatio: window.devicePixelRatio || 1,
    layerIds: Array.from(currentLayers.keys()),
  };
}
