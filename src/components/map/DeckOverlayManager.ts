/**
 * DeckOverlayManager – deterministic, correct deck.gl integration for MapLibre
 *
 * HARD RULE:
 * MapboxOverlay MUST be attached via onAdd() to map.getCanvasContainer(),
 * NOT via map.addControl().
 */

import { MapboxOverlay } from "@deck.gl/mapbox";
import { BitmapLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Map as MapLibreMap } from "maplibre-gl";
import { COORDINATE_SYSTEM } from "@deck.gl/core";

/* ============================================================
   Types
============================================================ */

export interface DeckLayerConfig {
  id: string;
  type: "bitmap" | "scatterplot";
  visible: boolean;
  opacity?: number;

  // Bitmap
  image?: HTMLCanvasElement | ImageBitmap;
  bounds?: [number, number, number, number]; // WGS84

  // Scatter
  data?: Array<any>;
  getPosition?: (d: any) => [number, number];
  getColor?: (d: any) => [number, number, number, number];
  getRadius?: (d: any) => number;
  radiusPixels?: number;
}

/* ============================================================
   Singleton state
============================================================ */

let overlay: MapboxOverlay | null = null;
let overlayElement: HTMLElement | null = null;
let attachedMap: MapLibreMap | null = null;
let layers = new Map<string, DeckLayerConfig>();
let devMode = false;

/* ============================================================
   Init / Attach
============================================================ */

export function initDeckOverlay(map: MapLibreMap, dev = false, opts?: { force?: boolean }): void {
  devMode = dev;

  if (!opts?.force && overlay && attachedMap === map) {
    return;
  }

  finalizeDeckOverlay();

  overlay = new MapboxOverlay({
    interleaved: false,
    layers: [],
  });

  // 🔴 THIS IS THE FIX
  overlayElement = (overlay as any).onAdd(map) as HTMLElement;
  map.getCanvasContainer().appendChild(overlayElement);

  attachedMap = map;

  applyDeckCSS();
  rebuildLayers();

  if (devMode) {
    addRenderProof();
  }

  console.log("[DeckOverlayManager] Initialized (correct canvas attachment)");
}

/* ============================================================
   CSS – minimal & deterministic
============================================================ */

function applyDeckCSS(): void {
  if (!overlayElement) return;

  overlayElement.style.position = "absolute";
  overlayElement.style.inset = "0";
  overlayElement.style.pointerEvents = "none";
  overlayElement.style.zIndex = "10";

  const canvas = overlayElement.querySelector("canvas") as HTMLCanvasElement | null;
  if (canvas) {
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  }
}

/* ============================================================
   Layer API
============================================================ */

export function updateLayer(cfg: DeckLayerConfig): void {
  if (!overlay) return;
  layers.set(cfg.id, cfg);
  rebuildLayers();
}

export function removeLayer(id: string): void {
  if (!overlay) return;
  layers.delete(id);
  rebuildLayers();
}

export function clearLayers(): void {
  if (!overlay) return;
  layers.clear();
  rebuildLayers();
}

/* ============================================================
   Layer rebuild
============================================================ */

function rebuildLayers(): void {
  if (!overlay) return;

  const deckLayers: any[] = [];

  layers.forEach((cfg) => {
    if (!cfg.visible) return;

    if (cfg.type === "bitmap" && cfg.image && cfg.bounds) {
      const [w, s, e, n] = cfg.bounds;
      if (w < -180 || e > 180 || s < -90 || n > 90) return;

      deckLayers.push(
        new BitmapLayer({
          id: cfg.id,
          image: cfg.image,
          bounds: cfg.bounds,
          opacity: cfg.opacity ?? 0.8,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          parameters: { depthTest: false },
        }),
      );
    }

    if (cfg.type === "scatterplot" && cfg.data) {
      deckLayers.push(
        new ScatterplotLayer({
          id: cfg.id,
          data: cfg.data,
          getPosition: cfg.getPosition ?? ((d) => d.position),
          getColor: cfg.getColor ?? (() => [255, 0, 255, 255]),
          getRadius: cfg.getRadius ?? (() => 10),
          radiusUnits: "pixels",
          radiusMinPixels: cfg.radiusPixels ?? 10,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        }),
      );
    }
  });

  overlay.setProps({ layers: deckLayers });

  if (devMode) {
    console.log(
      "[DeckOverlayManager] Layers:",
      deckLayers.map((l) => l.id),
    );
  }
}

/* ============================================================
   Diagnostics
============================================================ */

export function isReady(): boolean {
  return !!overlay && !!overlayElement && !!attachedMap;
}

export function getDiagnostics() {
  const canvas = overlayElement?.querySelector("canvas") as HTMLCanvasElement | null;
  const rect = canvas?.getBoundingClientRect();

  return {
    initialized: isReady(),
    layerCount: layers.size,
    layerIds: [...layers.keys()],
    canvasCssSize: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    bufferSize: canvas ? { w: canvas.width, h: canvas.height } : null,
    dpr: window.devicePixelRatio || 1,
  };
}

/* ============================================================
   Cleanup
============================================================ */

export function finalizeDeckOverlay(): void {
  if (overlay && attachedMap) {
    try {
      overlay.setProps({ layers: [] });
      (overlay as any).onRemove(attachedMap);
      overlayElement?.remove();
      (overlay as any).finalize?.();
    } catch {
      /* noop */
    }
  }

  overlay = null;
  overlayElement = null;
  attachedMap = null;
  layers.clear();

  console.log("[DeckOverlayManager] Finalized");
}

/* ============================================================
   Dev proof (optional)
============================================================ */

function addRenderProof(): void {
  if (!attachedMap) return;

  const c = attachedMap.getCenter();
  updateLayer({
    id: "render-proof-center",
    type: "scatterplot",
    visible: true,
    data: [{ position: [c.lng, c.lat] }],
    radiusPixels: 20,
  });
}
