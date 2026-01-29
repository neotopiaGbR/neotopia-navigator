import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import { MVTLayer } from '@deck.gl/geo-layers';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { COORDINATE_SYSTEM } from '@deck.gl/core';

// Development-only logging
const DEV = import.meta.env.DEV;
const log = (msg: string, ...args: unknown[]) => DEV && console.log(`[DeckOverlayManager] ${msg}`, ...args);
const warn = (msg: string, ...args: unknown[]) => DEV && console.warn(`[DeckOverlayManager] ${msg}`, ...args);

export interface DeckLayerConfig {
  id: string;
  type: 'bitmap' | 'scatterplot' | 'geojson' | 'tile' | 'mvt';
  visible: boolean;
  opacity?: number;
  // Bitmap layer
  image?: HTMLCanvasElement | ImageBitmap;
  bounds?: [number, number, number, number];
  // GeoJson layer
  data?: any;
  styleConfig?: {
    getFillColor?: (feature: any) => [number, number, number, number];
    getLineColor?: (feature: any) => [number, number, number, number];
    lineWidth?: number;
    pickable?: boolean;
  };
  // Tile layer (COG)
  tileUrl?: string;
  tileBounds?: { west: number; south: number; east: number; north: number };
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
  loadTile?: (tile: { bbox: any; z: number }) => Promise<{ image: ImageBitmap; bounds: [number, number, number, number] } | null>;
  // MVT layer (PMTiles)
  pmtilesUrl?: string;
  layerName?: string;
}

// Singleton state - managed carefully to prevent memory leaks
let overlayInstance: MapboxOverlay | null = null;
let attachedMap: MapLibreMap | null = null;
const currentLayers: Map<string, DeckLayerConfig> = new Map();
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
  
  // Clean up existing overlay
  if (overlayInstance) {
    try {
      if (attachedMap) {
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
    layers: [],
    _typedArrayManagerProps: {
      overAlloc: 2,
      poolSize: 100,
    },
  });

  try {
    const canvasContainer = map.getCanvasContainer();
    overlayContainerEl = overlayInstance.onAdd(map as any) as unknown as HTMLElement;
    overlayContainerEl.classList.add('deckgl-overlay-container');
    overlayContainerEl.style.cssText = 'position: absolute; inset: 0; z-index: 20; pointer-events: none;';
    
    const mapCanvas = map.getCanvas();
    const deckCanvas = overlayContainerEl.querySelector('canvas');
    if (deckCanvas && mapCanvas) {
      deckCanvas.width = mapCanvas.width;
      deckCanvas.height = mapCanvas.height;
      deckCanvas.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%;';
    }
    
    canvasContainer.appendChild(overlayContainerEl);
    log('Attached to canvasContainer, canvas size:', mapCanvas?.width, 'x', mapCanvas?.height);
  } catch (err) {
    warn('Manual attach failed, using addControl fallback:', err);
    map.addControl(overlayInstance as any);
  }
  attachedMap = map;
  
  rebuildLayers();
  log('Initialized');
}

export function updateLayer(config: DeckLayerConfig) {
  log(`updateLayer: ${config.id}`, { type: config.type, visible: config.visible, opacity: config.opacity });
  currentLayers.set(config.id, config);
  rebuildLayers();
}

export function removeLayer(id: string) {
  if (currentLayers.has(id)) {
    log(`removeLayer: ${id}`);
    currentLayers.delete(id);
    rebuildLayers();
  }
}

function rebuildLayers() {
  if (!overlayInstance) {
    warn('rebuildLayers called but overlayInstance is null');
    return;
  }

  const visibleConfigs = Array.from(currentLayers.values()).filter(l => l.visible);
  
  const layers = visibleConfigs
    .map(c => {
      // BitmapLayer for raster data
      if (c.type === 'bitmap' && c.image && c.bounds) {
        log(`Building BitmapLayer: ${c.id}`);
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
      
      // GeoJsonLayer for vector data
      if (c.type === 'geojson' && c.data) {
        log(`Building GeoJsonLayer: ${c.id}`);
        
        const style = c.styleConfig || {};
        return new GeoJsonLayer({
          id: c.id,
          data: c.data,
          opacity: c.opacity ?? 0.6,
          stroked: true,
          filled: true,
          pickable: style.pickable ?? false,
          getFillColor: style.getFillColor || [100, 100, 100, 100],
          getLineColor: style.getLineColor || [50, 50, 50, 255],
          getLineWidth: style.lineWidth || 2,
          lineWidthUnits: 'pixels',
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          parameters: {
            depthTest: false,
            blend: true
          }
        });
      }
      
      // TileLayer for COG streaming (KOSTRA)
      if (c.type === 'tile' && c.tileUrl && c.loadTile) {
        log(`Building TileLayer (COG): ${c.id}`);
        
        const tileBounds = c.tileBounds || { west: 5.87, south: 47.27, east: 15.04, north: 55.06 };
        
        return new TileLayer({
          id: c.id,
          minZoom: c.minZoom ?? 5,
          maxZoom: c.maxZoom ?? 14,
          tileSize: c.tileSize ?? 256,
          opacity: c.opacity ?? 0.7,
          extent: [tileBounds.west, tileBounds.south, tileBounds.east, tileBounds.north],
          
          getTileData: async (tile: any) => {
            const { bbox, z } = tile;
            try {
              const result = await c.loadTile!({ bbox, z });
              return result;
            } catch (err) {
              warn(`Tile load failed:`, err);
              return null;
            }
          },
          
          renderSubLayers: (props: any) => {
            const { data } = props;
            if (!data || !data.image) return null;
            
            return new BitmapLayer({
              id: `${props.id}-bitmap`,
              image: data.image,
              bounds: data.bounds,
              opacity: c.opacity ?? 0.7,
              coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
              parameters: {
                depthTest: false,
                blend: true
              }
            });
          },
        });
      }
      
      // MVTLayer for PMTiles streaming (CatRaRE)
      if (c.type === 'mvt' && c.pmtilesUrl) {
        log(`Building MVTLayer (PMTiles): ${c.id}`);
        
        const style = c.styleConfig || {};
        
        // Convert pmtiles:// URL format for MVTLayer
        const tileUrl = `pmtiles://${c.pmtilesUrl}/{z}/{x}/{y}.mvt`;
        
        return new MVTLayer({
          id: c.id,
          data: tileUrl,
          minZoom: 4,
          maxZoom: 12,
          opacity: c.opacity ?? 0.6,
          
          // Layer filtering
          ...(c.layerName ? { layerName: c.layerName } : {}),
          
          // Polygon styling
          filled: true,
          stroked: true,
          pickable: style.pickable ?? true,
          
          getFillColor: style.getFillColor || ((f: any) => [100, 100, 100, 100]),
          getLineColor: style.getLineColor || ((f: any) => [50, 50, 50, 255]),
          getLineWidth: style.lineWidth || 2,
          lineWidthUnits: 'pixels',
          
          parameters: {
            depthTest: false,
            blend: true
          },
          
          // Handle errors gracefully
          onTileError: (err: any) => {
            warn(`MVT tile error:`, err);
          },
        });
      }
      
      warn(`Skipping layer ${c.id}: unsupported type or missing data`, { type: c.type });
      return null;
    })
    .filter(Boolean);

  log(`setProps with ${layers.length} layers:`, layers.map((l: any) => l.id));
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
    canvasDimensions: deckCanvas ? { width: deckCanvas.width, height: deckCanvas.height } : null,
    canvasCssDimensions: deckCanvas ? { 
      width: Math.round(deckCanvas.getBoundingClientRect().width), 
      height: Math.round(deckCanvas.getBoundingClientRect().height) 
    } : null,
    devicePixelRatio: window.devicePixelRatio || 1,
    layerIds: Array.from(currentLayers.keys()),
  };
}
