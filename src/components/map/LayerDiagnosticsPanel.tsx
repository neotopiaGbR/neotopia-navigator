/**
 * Layer Diagnostics Panel (Dev/Admin only)
 * 
 * Shows real-time status of all map layers:
 * - Active layers and their z-order
 * - Bounds per layer (WGS84)
 * - CRS information
 * - deck.gl canvas status
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bug, X, CheckCircle, AlertTriangle, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMapLayers } from './MapLayersContext';
import { useAuth } from '@/contexts/AuthContext';

interface LayerInfo {
  id: string;
  type: 'maplibre' | 'deckgl';
  visible: boolean;
  bounds?: [number, number, number, number];
  crs: string;
  zIndex: number;
  status: 'active' | 'loading' | 'error' | 'hidden';
}

interface LayerDiagnosticsPanelProps {
  map: maplibregl.Map | null;
}

const LayerDiagnosticsPanel: React.FC<LayerDiagnosticsPanelProps> = ({ map }) => {
  const { profile } = useAuth();
  const { overlays, heatLayers, airTemperature } = useMapLayers();
  const [isOpen, setIsOpen] = useState(false);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [deckCanvasInfo, setDeckCanvasInfo] = useState<{
    exists: boolean;
    width: number;
    height: number;
    visible: boolean;
    zIndex: string;
  }>({ exists: false, width: 0, height: 0, visible: false, zIndex: '' });

  const isAdmin = profile?.role === 'admin';
  const isDev = import.meta.env.DEV;

  // Check deck.gl canvas
  const checkDeckCanvas = useCallback(() => {
    const canvas = document.querySelector('canvas#deck-canvas, canvas.deck-canvas') as HTMLCanvasElement;
    if (canvas) {
      const style = window.getComputedStyle(canvas);
      return {
        exists: true,
        width: canvas.width,
        height: canvas.height,
        visible: style.display !== 'none' && style.visibility !== 'hidden',
        zIndex: style.zIndex,
      };
    }
    return { exists: false, width: 0, height: 0, visible: false, zIndex: '' };
  }, []);

  // Collect layer info
  const collectLayerInfo = useCallback(() => {
    const layerList: LayerInfo[] = [];
    let zIndex = 0;

    // MapLibre layers
    if (map && map.isStyleLoaded()) {
      try {
        const style = map.getStyle();
        if (style?.layers) {
          for (const layer of style.layers) {
            if (layer.id.includes('flood') || layer.id.includes('lst') || layer.id.includes('temperature')) {
              const visibility = map.getLayoutProperty(layer.id, 'visibility');
              layerList.push({
                id: layer.id,
                type: 'maplibre',
                visible: visibility !== 'none',
                crs: 'EPSG:4326 (WGS84)',
                zIndex: zIndex++,
                status: visibility !== 'none' ? 'active' : 'hidden',
              });
            }
          }
        }
      } catch (e) {
        // Ignore style access errors
      }
    }

    // MODIS Global LST
    if (overlays.ecostress.enabled) {
      layerList.push({
        id: 'global-lst-layer',
        type: 'maplibre',
        visible: heatLayers.globalLSTEnabled,
        crs: 'EPSG:3857 (Web Mercator)',
        zIndex: zIndex++,
        status: heatLayers.globalLSTEnabled ? 'active' : 'hidden',
      });
    }

    // ECOSTRESS Composite
    if (overlays.ecostress.enabled && overlays.ecostress.metadata?.status === 'match') {
      layerList.push({
        id: 'ecostress-summer-composite',
        type: 'deckgl',
        visible: true,
        bounds: overlays.ecostress.metadata?.regionBbox as [number, number, number, number] | undefined,
        crs: 'EPSG:4326 (WGS84)',
        zIndex: zIndex++,
        status: overlays.ecostress.loading ? 'loading' : 'active',
      });
    }

    // DWD Air Temperature
    if (airTemperature.enabled) {
      layerList.push({
        id: 'dwd-air-temperature-fill',
        type: 'maplibre',
        visible: true,
        bounds: airTemperature.data?.bounds,
        crs: 'EPSG:4326 (from EPSG:3035)',
        zIndex: zIndex++,
        status: airTemperature.loading ? 'loading' : airTemperature.error ? 'error' : 'active',
      });
    }

    setLayers(layerList);
  }, [map, overlays, heatLayers, airTemperature]);

  // Periodic refresh
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      setDeckCanvasInfo(checkDeckCanvas());
      collectLayerInfo();
    }, 1000);

    // Initial check
    setDeckCanvasInfo(checkDeckCanvas());
    collectLayerInfo();

    return () => clearInterval(interval);
  }, [isOpen, checkDeckCanvas, collectLayerInfo]);

  if (!isAdmin && !isDev) return null;

  const formatBounds = (bounds: [number, number, number, number] | undefined) => {
    if (!bounds) return 'N/A';
    return `[${bounds[0].toFixed(3)}, ${bounds[1].toFixed(3)}, ${bounds[2].toFixed(3)}, ${bounds[3].toFixed(3)}]`;
  };

  return (
    <>
      {/* Toggle Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="absolute top-3 left-3 z-20 bg-purple-100 dark:bg-purple-900/30 border-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800/30"
      >
        <Layers className="h-4 w-4 mr-1 text-purple-600" />
        Layers
      </Button>

      {/* Panel */}
      {isOpen && (
        <div className="absolute top-12 left-3 z-20 w-[380px] max-h-[60vh] bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-purple-100 dark:bg-purple-900/30 border-b border-border">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Bug className="h-4 w-4" />
              Layer Diagnostics
            </h3>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsOpen(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className="p-4 space-y-4 overflow-y-auto max-h-[50vh]">
            {/* Deck.gl Canvas Status */}
            <div className="p-2 rounded bg-muted/50">
              <div className="text-xs font-medium mb-1">Deck.gl Canvas</div>
              <div className="text-xs space-y-0.5">
                <div className="flex items-center gap-2">
                  {deckCanvasInfo.exists ? (
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-red-500" />
                  )}
                  <span>
                    {deckCanvasInfo.exists 
                      ? `${deckCanvasInfo.width}×${deckCanvasInfo.height}px` 
                      : 'Not found in DOM'}
                  </span>
                </div>
                {deckCanvasInfo.exists && (
                  <>
                    <div>Visible: {deckCanvasInfo.visible ? 'Yes' : 'No'}</div>
                    <div>z-index: {deckCanvasInfo.zIndex || 'auto'}</div>
                  </>
                )}
              </div>
            </div>

            {/* Active Layers */}
            <div>
              <div className="text-xs font-medium mb-2">Active Layers ({layers.length})</div>
              <div className="space-y-2">
                {layers.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No overlay layers active</div>
                ) : (
                  layers.map((layer, i) => (
                    <div key={layer.id} className="p-2 rounded border border-border/50 bg-muted/20 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{layer.id}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          layer.status === 'active' ? 'bg-green-500/20 text-green-600' :
                          layer.status === 'loading' ? 'bg-blue-500/20 text-blue-600' :
                          layer.status === 'error' ? 'bg-red-500/20 text-red-600' :
                          'bg-gray-500/20 text-gray-600'
                        }`}>
                          {layer.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
                        <div>Type: <span className="text-foreground">{layer.type}</span></div>
                        <div>z-order: <span className="text-foreground">{layer.zIndex}</span></div>
                        <div className="col-span-2">CRS: <span className="text-foreground">{layer.crs}</span></div>
                        {layer.bounds && (
                          <div className="col-span-2">
                            Bounds: <code className="text-[10px] text-foreground">{formatBounds(layer.bounds)}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Layer State Summary */}
            <div className="p-2 rounded bg-muted/30 text-xs">
              <div className="font-medium mb-1">State Summary</div>
              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                <div>ECOSTRESS: <span className="text-foreground">{overlays.ecostress.enabled ? 'ON' : 'OFF'}</span></div>
                <div>Status: <span className="text-foreground">{String(overlays.ecostress.metadata?.status || 'none')}</span></div>
                <div>DWD Air: <span className="text-foreground">{airTemperature.enabled ? 'ON' : 'OFF'}</span></div>
                <div>Data: <span className="text-foreground">{airTemperature.data ? `${airTemperature.data.grid.length} pts` : 'none'}</span></div>
                <div>MODIS LST: <span className="text-foreground">{heatLayers.globalLSTEnabled ? 'ON' : 'OFF'}</span></div>
                <div>Aggregation: <span className="text-foreground">{heatLayers.aggregationMethod}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LayerDiagnosticsPanel;
