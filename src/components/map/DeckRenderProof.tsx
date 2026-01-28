/**
 * DECK RENDER PROOF - Binary visibility test
 * 
 * This component tests if deck.gl is actually rendering to the map.
 * If the magenta dot is NOT visible, the overlay/canvas mounting is broken.
 * If the magenta dot IS visible but ECOSTRESS isn't, the issue is in the data pipeline.
 * 
 * STEP 1: Magenta center dot
 * STEP 2: Synthetic "TEST" bitmap covering viewport
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer, ScatterplotLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { Map as MapLibreMap } from 'maplibre-gl';

interface DeckRenderProofProps {
  map: MapLibreMap | null;
  enabled: boolean;
}

interface DebugHUD {
  deckCanvasFound: boolean;
  deckCanvasSize: string;
  mapCanvasSize: string;
  layerCount: number;
  viewportBounds: string;
  testBitmapBounds: string;
  lastError: string | null;
  magentaDotPosition: string;
  syntheticCanvasSize: string;
  opaquePixels: number;
}

/**
 * Create a synthetic test canvas with a visible pattern.
 */
function createSyntheticTestCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  
  // Fill with semi-transparent cyan background
  ctx.fillStyle = 'rgba(0, 255, 255, 0.7)';
  ctx.fillRect(0, 0, width, height);
  
  // Draw diagonal stripes for visibility
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
  ctx.lineWidth = 20;
  for (let i = -height; i < width; i += 50) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }
  
  // Draw large "TEST" text
  ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.font = 'bold 80px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TEST', width / 2, height / 2);
  
  // Draw border
  ctx.strokeStyle = 'rgba(255, 0, 255, 1)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, width - 10, height - 10);
  
  return canvas;
}

export function DeckRenderProof({ map, enabled }: DeckRenderProofProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [hud, setHud] = useState<DebugHUD | null>(null);
  
  const mountOverlay = useCallback(() => {
    if (!map) {
      console.error('[DeckRenderProof] No map instance');
      return;
    }
    
    // Remove existing overlay
    if (overlayRef.current) {
      try {
        map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
      } catch {}
      overlayRef.current = null;
    }
    
    try {
      // Get map center and bounds
      const center = map.getCenter();
      const bounds = map.getBounds();
      const west = bounds.getWest();
      const south = bounds.getSouth();
      const east = bounds.getEast();
      const north = bounds.getNorth();
      
      const centerPos: [number, number] = [center.lng, center.lat];
      const bitmapBounds: [number, number, number, number] = [west, south, east, north];
      
      console.log('[DeckRenderProof] ====== MOUNTING RENDER PROOF ======');
      console.log('[DeckRenderProof] Map center:', centerPos);
      console.log('[DeckRenderProof] Viewport bounds [W,S,E,N]:', bitmapBounds);
      
      // STEP 1: Create magenta center dot
      const magentaDot = new ScatterplotLayer({
        id: 'deck-render-proof-dot',
        data: [{ position: centerPos }],
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
      
      // STEP 2: Create synthetic TEST bitmap covering viewport
      const testCanvas = createSyntheticTestCanvas(512, 512);
      
      // Count opaque pixels for validation
      const ctx = testCanvas.getContext('2d')!;
      const imgData = ctx.getImageData(0, 0, testCanvas.width, testCanvas.height);
      let opaqueCount = 0;
      for (let i = 3; i < imgData.data.length; i += 16) { // Sample every 4th pixel
        if (imgData.data[i] > 0) opaqueCount++;
      }
      
      console.log('[DeckRenderProof] Synthetic canvas:', {
        size: `${testCanvas.width}x${testCanvas.height}`,
        opaquePixels: opaqueCount,
      });
      
      const testBitmap = new BitmapLayer({
        id: 'deck-render-proof-bitmap',
        bounds: bitmapBounds,
        image: testCanvas,
        opacity: 0.7,
        visible: true,
        pickable: false,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        parameters: { depthTest: false },
      });
      
      // Create overlay with BOTH layers
      const overlay = new MapboxOverlay({
        interleaved: false,
        layers: [testBitmap, magentaDot], // Bitmap first (below), dot second (above)
      });
      
      map.addControl(overlay as unknown as maplibregl.IControl);
      overlayRef.current = overlay;
      
      console.log('[DeckRenderProof] ✅ Overlay mounted with 2 layers');
      
      // Update HUD after short delay to let canvas mount
      setTimeout(() => {
        const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
        const deckCanvas = canvases.find((c) => {
          const id = (c.id || '').toLowerCase();
          const cls = String(c.className || '').toLowerCase();
          return id.includes('deck') || cls.includes('deck') || cls.includes('deckgl');
        });
        
        const mapCanvas = map.getCanvas();
        
        setHud({
          deckCanvasFound: !!deckCanvas,
          deckCanvasSize: deckCanvas ? `${deckCanvas.width}x${deckCanvas.height}` : 'NOT FOUND',
          mapCanvasSize: mapCanvas ? `${mapCanvas.width}x${mapCanvas.height}` : 'unknown',
          layerCount: 2,
          viewportBounds: `[${west.toFixed(4)}, ${south.toFixed(4)}, ${east.toFixed(4)}, ${north.toFixed(4)}]`,
          testBitmapBounds: `[${west.toFixed(4)}, ${south.toFixed(4)}, ${east.toFixed(4)}, ${north.toFixed(4)}]`,
          lastError: null,
          magentaDotPosition: `[${center.lng.toFixed(4)}, ${center.lat.toFixed(4)}]`,
          syntheticCanvasSize: `${testCanvas.width}x${testCanvas.height}`,
          opaquePixels: opaqueCount,
        });
        
        // CRITICAL: Check for default canvas size bug
        if (deckCanvas) {
          const isDefaultSize = deckCanvas.width === 300 && deckCanvas.height === 150;
          if (isDefaultSize) {
            console.error('[DeckRenderProof] ❌ DECK CANVAS HAS DEFAULT 300x150 SIZE — OVERLAY NOT SIZED CORRECTLY!');
            // Try to force resize
            map.resize();
          } else {
            console.log('[DeckRenderProof] ✅ Deck canvas size OK:', `${deckCanvas.width}x${deckCanvas.height}`);
          }
        } else {
          console.error('[DeckRenderProof] ❌ DECK CANVAS NOT FOUND IN DOM!');
        }
      }, 200);
      
    } catch (err) {
      console.error('[DeckRenderProof] ❌ Failed to mount:', err);
      setHud((prev) => prev ? { ...prev, lastError: String(err) } : null);
    }
  }, [map]);
  
  const removeOverlay = useCallback(() => {
    if (overlayRef.current && map) {
      try {
        map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
      } catch {}
      overlayRef.current = null;
    }
    setHud(null);
  }, [map]);
  
  // Mount/unmount based on enabled state
  useEffect(() => {
    if (!map) return;
    
    if (enabled) {
      if (map.isStyleLoaded()) {
        mountOverlay();
      } else {
        map.once('style.load', mountOverlay);
      }
    } else {
      removeOverlay();
    }
    
    // Handle style changes
    const handleStyleLoad = () => {
      if (enabled) {
        setTimeout(mountOverlay, 100);
      }
    };
    
    map.on('style.load', handleStyleLoad);
    
    return () => {
      map.off('style.load', handleStyleLoad);
      removeOverlay();
    };
  }, [map, enabled, mountOverlay, removeOverlay]);
  
  // Render HUD overlay
  if (!enabled || !hud) return null;
  
  return (
    <div 
      className="absolute top-20 left-4 z-50 p-4 rounded-lg shadow-xl max-w-sm text-xs font-mono"
      style={{ 
        backgroundColor: 'rgba(255, 0, 255, 0.95)',
        color: 'white',
        border: '3px solid white',
      }}
    >
      <div className="font-bold text-sm mb-2">🔬 DECK RENDER PROOF</div>
      
      <div className="space-y-1">
        <div>
          <span className="opacity-70">Deck Canvas:</span>{' '}
          <span className={hud.deckCanvasFound ? 'text-green-300' : 'text-red-300 font-bold'}>
            {hud.deckCanvasFound ? `✅ ${hud.deckCanvasSize}` : '❌ NOT FOUND'}
          </span>
        </div>
        
        <div>
          <span className="opacity-70">Map Canvas:</span> {hud.mapCanvasSize}
        </div>
        
        <div>
          <span className="opacity-70">Layers:</span> {hud.layerCount}
        </div>
        
        <div>
          <span className="opacity-70">Magenta Dot:</span> {hud.magentaDotPosition}
        </div>
        
        <div>
          <span className="opacity-70">Test Bitmap:</span> {hud.syntheticCanvasSize}, {hud.opaquePixels} opaque px
        </div>
        
        <div className="text-[10px] opacity-70 break-all">
          <div>Viewport: {hud.viewportBounds}</div>
          <div>Bitmap: {hud.testBitmapBounds}</div>
        </div>
        
        {hud.lastError && (
          <div className="text-red-300 mt-2">
            ❌ {hud.lastError}
          </div>
        )}
      </div>
      
      <div className="mt-3 pt-2 border-t border-white/30 text-[10px] opacity-80">
        <div className="font-bold">EXPECTED:</div>
        <div>• Magenta dot at map center</div>
        <div>• Cyan/red striped "TEST" over viewport</div>
        <div>If you see NOTHING → deck.gl pipeline is broken</div>
      </div>
    </div>
  );
}

export default DeckRenderProof;
