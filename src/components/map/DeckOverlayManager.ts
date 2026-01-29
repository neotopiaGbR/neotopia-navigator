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
let overlayContainerEl: HTMLElement | null = null;

// CSS Injection um Canvas sichtbar zu machen
function injectCSS() {
  if (typeof document === 'undefined') return;
  const id = 'deck-force-visible';
  if (!document.getElementById(id)) {
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .maplibregl-map canvas.deckgl-canvas,
      .maplibregl-map canvas.deck-canvas,
      .maplibregl-map canvas[data-deck] {
        z-index: 20 !important;
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
    try {
      if (attachedMap) {
        // If we attached manually, detach first.
        try { (overlayInstance as any).onRemove(attachedMap as any); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    try { overlayInstance.finalize(); } catch { /* ignore */ }
  }

  if (overlayContainerEl) {
    try { overlayContainerEl.remove(); } catch { /* ignore */ }
    overlayContainerEl = null;
  }

  overlayInstance = new MapboxOverlay({
    interleaved: false,
    layers: []
  });

  // NOTE: In this project we attach deck manually to avoid MapLibre control/lifecycle edge cases
  // (canvas occasionally not visible / lost on style changes).
  try {
    const container = map.getContainer();
    overlayContainerEl = overlayInstance.onAdd(map as any) as unknown as HTMLElement;
    overlayContainerEl.classList.add('deckgl-overlay-container');
    // Ensure the container sits above the map canvas.
    overlayContainerEl.style.position = 'absolute';
    overlayContainerEl.style.top = '0';
    overlayContainerEl.style.left = '0';
    overlayContainerEl.style.right = '0';
    overlayContainerEl.style.bottom = '0';
    overlayContainerEl.style.pointerEvents = 'none';
    overlayContainerEl.style.zIndex = '20';
    container.appendChild(overlayContainerEl);
  } catch (err) {
    // Fallback to standard control mounting
    map.addControl(overlayInstance as any);
  }
  attachedMap = map;
  
  rebuildLayers();
  console.log('[DeckOverlayManager] Initialized');
}

export function updateLayer(config: DeckLayerConfig) {
  console.log(`[DeckOverlayManager] updateLayer: ${config.id}`, {
    visible: config.visible,
    hasBounds: !!config.bounds,
    hasImage: !!config.image,
    bounds: config.bounds,
    opacity: config.opacity,
  });
  currentLayers.set(config.id, config);
  rebuildLayers();
}

export function removeLayer(id: string) {
  if (currentLayers.has(id)) {
    console.log(`[DeckOverlayManager] removeLayer: ${id}`);
    currentLayers.delete(id);
    rebuildLayers();
  }
}

function rebuildLayers() {
  if (!overlayInstance) {
    console.warn('[DeckOverlayManager] rebuildLayers called but overlayInstance is null');
    return;
  }

  const visibleConfigs = Array.from(currentLayers.values()).filter(l => l.visible);
  
  const layers = visibleConfigs
    .map(c => {
      if (c.type === 'bitmap' && c.image && c.bounds) {
        console.log(`[DeckOverlayManager] Building BitmapLayer: ${c.id}`, {
          bounds: c.bounds,
          imageType: c.image.constructor.name,
          opacity: c.opacity,
        });
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
      console.warn(`[DeckOverlayManager] Skipping layer ${c.id}: missing image or bounds`, {
        hasImage: !!c.image,
        hasBounds: !!c.bounds,
        type: c.type,
      });
      return null;
    })
    .filter(Boolean);

  console.log(`[DeckOverlayManager] setProps with ${layers.length} layers:`, layers.map((l: any) => l.id));
  overlayInstance.setProps({ layers });
}

export function finalizeDeckOverlay() {
  if (overlayInstance && attachedMap) {
    try { (overlayInstance as any).onRemove(attachedMap as any); } catch { /* ignore */ }
  }
  if (overlayInstance) {
    try { overlayInstance.finalize(); } catch { /* ignore */ }
  }
  overlayInstance = null;
  attachedMap = null;
  currentLayers.clear();

  if (overlayContainerEl) {
    try { overlayContainerEl.remove(); } catch { /* ignore */ }
    overlayContainerEl = null;
  }
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
  const deckCanvas = container?.querySelector?.(
    'canvas.deckgl-canvas, canvas[id*="deck"], canvas.deck-canvas, canvas[data-deck]'
  ) as HTMLCanvasElement | null;
  
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
