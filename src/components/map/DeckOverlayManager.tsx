/**
 * DECK OVERLAY MANAGER
 * 
 * SINGLE SOURCE OF TRUTH for all deck.gl overlays on the MapLibre map.
 * 
 * Rules enforced:
 * 1. MapboxOverlay is created ONCE (useRef)
 * 2. map.addControl(overlay) happens ONCE on map load
 * 3. overlay.setProps({ layers }) is the ONLY way layers change
 * 4. Never recreate overlay when toggling layers
 * 5. Layer ordering is deterministic: proof → DWD → ECOSTRESS → debug
 * 
 * This eliminates all race conditions, duplicate overlays, and silent failures.
 */

import { useEffect, useRef, useCallback, useState, createContext, useContext } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { Layer } from '@deck.gl/core';
import { BitmapLayer, ScatterplotLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { Map as MapLibreMap } from 'maplibre-gl';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface DebugHUD {
  deckCanvasFound: boolean;
  deckCanvasSize: string;
  mapCanvasSize: string;
  layerCount: number;
  activeLayerIds: string[];
  viewportBounds: string;
  zoom: number;
  lastSetPropsTime: string;
  lastError: string | null;
  overlayMountedOnce: boolean;
  proofDotVisible: boolean;
  proofBitmapVisible: boolean;
}

export interface DeckOverlayManagerState {
  isReady: boolean;
  debugHud: DebugHUD | null;
  setLayers: (layers: Layer[]) => void;
  forceRedraw: () => void;
}

const defaultState: DeckOverlayManagerState = {
  isReady: false,
  debugHud: null,
  setLayers: () => {},
  forceRedraw: () => {},
};

const DeckOverlayContext = createContext<DeckOverlayManagerState>(defaultState);

export function useDeckOverlay() {
  return useContext(DeckOverlayContext);
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER PROOF LAYERS (DEV ONLY)
// ═══════════════════════════════════════════════════════════════════════════

function createProofDotLayer(center: [number, number]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'deck-proof-dot',
    data: [{ position: center }],
    getPosition: (d: { position: [number, number] }) => d.position,
    getFillColor: [255, 0, 255, 255], // Bright magenta
    getRadius: 80,
    radiusUnits: 'pixels',
    opacity: 1,
    visible: true,
    pickable: false,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
    parameters: { depthTest: false },
  });
}

function createProofBitmapCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  
  // Fill with semi-transparent cyan background
  ctx.fillStyle = 'rgba(0, 255, 255, 0.6)';
  ctx.fillRect(0, 0, 512, 512);
  
  // Draw diagonal stripes
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
  ctx.lineWidth = 16;
  for (let i = -512; i < 512; i += 50) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 512, 512);
    ctx.stroke();
  }
  
  // Draw "DECK OK" text
  ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.font = 'bold 72px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DECK OK', 256, 256);
  
  // Draw border
  ctx.strokeStyle = 'rgba(255, 0, 255, 1)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 504, 504);
  
  return canvas;
}

function createProofBitmapLayer(bounds: [number, number, number, number]): BitmapLayer {
  const canvas = createProofBitmapCanvas();
  return new BitmapLayer({
    id: 'deck-proof-bitmap',
    bounds,
    image: canvas,
    opacity: 0.4,
    visible: true,
    pickable: false,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
    parameters: { depthTest: false },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// DECK OVERLAY MANAGER COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface DeckOverlayManagerProps {
  map: MapLibreMap | null;
  children: React.ReactNode;
  showProofLayers?: boolean; // DEV only
}

export function DeckOverlayManager({ 
  map, 
  children, 
  showProofLayers = import.meta.env.DEV 
}: DeckOverlayManagerProps) {
  // === REFS: Stable across re-renders ===
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const isAttachedRef = useRef(false);
  const userLayersRef = useRef<Layer[]>([]);
  const lastSetPropsTimeRef = useRef<string>('never');
  
  // === STATE: For UI/context updates ===
  const [isReady, setIsReady] = useState(false);
  const [debugHud, setDebugHud] = useState<DebugHUD | null>(null);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTE FINAL LAYERS (proof + user)
  // ═══════════════════════════════════════════════════════════════════════════
  const computeFinalLayers = useCallback((): Layer[] => {
    if (!map) return [];
    
    const layers: Layer[] = [];
    
    // 1. PROOF LAYERS (bottom) - only in DEV
    if (showProofLayers) {
      try {
        const center = map.getCenter();
        const bounds = map.getBounds();
        const viewBounds: [number, number, number, number] = [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ];
        
        layers.push(createProofBitmapLayer(viewBounds));
        layers.push(createProofDotLayer([center.lng, center.lat]));
      } catch (err) {
        console.error('[DeckOverlayManager] Failed to create proof layers:', err);
      }
    }
    
    // 2. USER LAYERS (on top)
    layers.push(...userLayersRef.current);
    
    return layers;
  }, [map, showProofLayers]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SET LAYERS API
  // ═══════════════════════════════════════════════════════════════════════════
  const setLayers = useCallback((layers: Layer[]) => {
    userLayersRef.current = layers;
    
    if (overlayRef.current && isAttachedRef.current) {
      const finalLayers = computeFinalLayers();
      overlayRef.current.setProps({ layers: finalLayers });
      lastSetPropsTimeRef.current = new Date().toISOString();
      
      console.log('[DeckOverlayManager] setProps called:', {
        userLayers: layers.length,
        totalLayers: finalLayers.length,
        layerIds: finalLayers.map(l => l.id),
      });
      
      updateDebugHud();
    }
  }, [computeFinalLayers]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FORCE REDRAW
  // ═══════════════════════════════════════════════════════════════════════════
  const forceRedraw = useCallback(() => {
    if (overlayRef.current && isAttachedRef.current) {
      const finalLayers = computeFinalLayers();
      overlayRef.current.setProps({ layers: finalLayers });
      lastSetPropsTimeRef.current = new Date().toISOString();
      console.log('[DeckOverlayManager] Force redraw triggered');
      updateDebugHud();
    }
  }, [computeFinalLayers]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE DEBUG HUD
  // ═══════════════════════════════════════════════════════════════════════════
  const updateDebugHud = useCallback(() => {
    if (!map || !import.meta.env.DEV) return;
    
    const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
    const deckCanvas = canvases.find((c) => {
      const id = (c.id || '').toLowerCase();
      const cls = String(c.className || '').toLowerCase();
      return id.includes('deck') || cls.includes('deck');
    });
    
    const mapCanvas = map.getCanvas();
    const bounds = map.getBounds();
    const layers = userLayersRef.current;
    
    setDebugHud({
      deckCanvasFound: !!deckCanvas,
      deckCanvasSize: deckCanvas ? `${deckCanvas.width}x${deckCanvas.height}` : 'NOT FOUND',
      mapCanvasSize: mapCanvas ? `${mapCanvas.width}x${mapCanvas.height}` : 'unknown',
      layerCount: layers.length + (showProofLayers ? 2 : 0),
      activeLayerIds: layers.map(l => l.id),
      viewportBounds: `[${bounds.getWest().toFixed(3)}, ${bounds.getSouth().toFixed(3)}, ${bounds.getEast().toFixed(3)}, ${bounds.getNorth().toFixed(3)}]`,
      zoom: Math.round(map.getZoom() * 10) / 10,
      lastSetPropsTime: lastSetPropsTimeRef.current,
      lastError: null,
      overlayMountedOnce: isAttachedRef.current,
      proofDotVisible: showProofLayers,
      proofBitmapVisible: showProofLayers,
    });
  }, [map, showProofLayers]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MOUNT OVERLAY ONCE
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!map) return;
    
    const attachOverlay = () => {
      // CRITICAL: Only attach once
      if (isAttachedRef.current) {
        console.log('[DeckOverlayManager] Overlay already attached, skipping');
        return;
      }
      
      // Create overlay if not exists
      if (!overlayRef.current) {
        overlayRef.current = new MapboxOverlay({
          interleaved: false,
          layers: [],
        });
        console.log('[DeckOverlayManager] MapboxOverlay created');
      }
      
      // Attach to map
      try {
        map.addControl(overlayRef.current as unknown as maplibregl.IControl);
        isAttachedRef.current = true;
        console.log('[DeckOverlayManager] ✅ Overlay attached to map (ONCE)');
        
        // Set initial layers
        const finalLayers = computeFinalLayers();
        overlayRef.current.setProps({ layers: finalLayers });
        lastSetPropsTimeRef.current = new Date().toISOString();
        
        setIsReady(true);
        
        // Update HUD after a short delay
        setTimeout(updateDebugHud, 200);
        
        // Trigger map resize to ensure deck canvas is sized correctly
        map.resize();
      } catch (err) {
        console.error('[DeckOverlayManager] ❌ Failed to attach overlay:', err);
        setDebugHud(prev => prev ? { ...prev, lastError: String(err) } : null);
      }
    };
    
    // Attach when map style is loaded
    if (map.isStyleLoaded()) {
      attachOverlay();
    } else {
      map.once('style.load', attachOverlay);
    }
    
    // Handle style changes (basemap switches)
    const handleStyleLoad = () => {
      // Re-set layers after style change (but DON'T recreate overlay)
      if (overlayRef.current && isAttachedRef.current) {
        setTimeout(() => {
          const finalLayers = computeFinalLayers();
          overlayRef.current!.setProps({ layers: finalLayers });
          lastSetPropsTimeRef.current = new Date().toISOString();
          console.log('[DeckOverlayManager] Layers re-applied after style change');
          updateDebugHud();
        }, 100);
      }
    };
    
    map.on('style.load', handleStyleLoad);
    
    // Cleanup
    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [map, computeFinalLayers, updateDebugHud]);
  
  // Update proof layers when map moves (only in DEV)
  useEffect(() => {
    if (!map || !showProofLayers) return;
    
    const handleMoveEnd = () => {
      if (overlayRef.current && isAttachedRef.current) {
        const finalLayers = computeFinalLayers();
        overlayRef.current.setProps({ layers: finalLayers });
        updateDebugHud();
      }
    };
    
    map.on('moveend', handleMoveEnd);
    return () => { map.off('moveend', handleMoveEnd); };
  }, [map, showProofLayers, computeFinalLayers, updateDebugHud]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT VALUE
  // ═══════════════════════════════════════════════════════════════════════════
  const contextValue: DeckOverlayManagerState = {
    isReady,
    debugHud,
    setLayers,
    forceRedraw,
  };
  
  return (
    <DeckOverlayContext.Provider value={contextValue}>
      {children}
      
      {/* DEBUG HUD (DEV only) */}
      {import.meta.env.DEV && showProofLayers && debugHud && (
        <div 
          className="absolute top-20 left-4 z-50 p-3 rounded-lg shadow-xl max-w-xs text-[11px] font-mono"
          style={{ 
            backgroundColor: 'rgba(255, 0, 255, 0.95)',
            color: 'white',
            border: '2px solid white',
          }}
        >
          <div className="font-bold text-sm mb-2">🔬 DECK OVERLAY MANAGER</div>
          
          <div className="space-y-0.5">
            <div>
              <span className="opacity-70">Overlay:</span>{' '}
              <span className={debugHud.overlayMountedOnce ? 'text-green-300' : 'text-red-300'}>
                {debugHud.overlayMountedOnce ? '✅ Mounted' : '❌ Not mounted'}
              </span>
            </div>
            
            <div>
              <span className="opacity-70">Canvas:</span>{' '}
              <span className={debugHud.deckCanvasFound ? 'text-green-300' : 'text-red-300 font-bold'}>
                {debugHud.deckCanvasFound ? `✅ ${debugHud.deckCanvasSize}` : '❌ NOT FOUND'}
              </span>
            </div>
            
            <div>
              <span className="opacity-70">Map:</span> {debugHud.mapCanvasSize}
            </div>
            
            <div>
              <span className="opacity-70">Layers:</span> {debugHud.layerCount} ({debugHud.activeLayerIds.join(', ') || 'none'})
            </div>
            
            <div>
              <span className="opacity-70">Zoom:</span> {debugHud.zoom}
            </div>
            
            <div className="text-[9px] opacity-70 break-all">
              Bounds: {debugHud.viewportBounds}
            </div>
            
            <div className="text-[9px] opacity-70">
              setProps: {debugHud.lastSetPropsTime}
            </div>
            
            {debugHud.lastError && (
              <div className="text-red-300 mt-1">
                ❌ {debugHud.lastError}
              </div>
            )}
          </div>
          
          <div className="mt-2 pt-2 border-t border-white/30 text-[9px] opacity-80">
            <div className="font-bold">EXPECTED:</div>
            <div>• Magenta dot at map center</div>
            <div>• Cyan "DECK OK" bitmap</div>
            <div>If missing → deck.gl broken</div>
          </div>
        </div>
      )}
    </DeckOverlayContext.Provider>
  );
}

export default DeckOverlayManager;
