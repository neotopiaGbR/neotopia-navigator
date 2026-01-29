/**
 * Overlay Diagnostics Panel (Admin/Dev only)
 * 
 * Provides real-time diagnostics for:
 * - MapLibre map instance status
 * - deck.gl canvas status and z-index
 * - Active overlay layers with bounds/CRS info
 * - Last request status per overlay
 */

import React, { useEffect, useState } from 'react';
import { getDiagnostics, isReady } from './DeckOverlayManager';
import { useMapLayers } from './MapLayersContext';
import { Bug, Map, Layers, CheckCircle, AlertCircle, XCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DiagnosticData {
  mapInstanceId: string | null;
  mapContainerSize: { width: number; height: number } | null;
  deckCanvasSize: { width: number; height: number } | null; // backing buffer (device pixels)
  deckCanvasCssSize: { width: number; height: number } | null; // CSS pixels
  devicePixelRatio: number;
  deckCanvasZIndex: string | null;
  deckInitialized: boolean;
  deckLayerCount: number;
  deckLayerIds: string[];
  overlayStatus: {
    ecostress: { enabled: boolean; status: string | null; error: string | null };
    floodRisk: { enabled: boolean; status: string | null; error: string | null };
    airTemperature: { enabled: boolean; status: string | null; error: string | null };
    globalLST: { enabled: boolean };
  };
}

interface OverlayDiagnosticsPanelProps {
  visible: boolean;
  mapRef: React.MutableRefObject<any>;
}

function getComputedZIndex(element: Element | null): string | null {
  if (!element) return null;
  return window.getComputedStyle(element).zIndex;
}

export function OverlayDiagnosticsPanel({ visible, mapRef }: OverlayDiagnosticsPanelProps) {
  const { overlays, heatLayers, airTemperature } = useMapLayers();
  const [diagnostics, setDiagnostics] = useState<DiagnosticData | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  
  useEffect(() => {
    if (!visible || !isOpen) return;
    
    const updateDiagnostics = () => {
      const map = mapRef.current;
      const mapContainer = map?.getContainer?.() as HTMLElement | null;
      const deckCanvas = (mapContainer
        ? (mapContainer.querySelector(
            'canvas.deckgl-canvas, canvas[id*="deck"], canvas.deck-canvas, canvas[data-deck]'
          ) as HTMLCanvasElement | null)
        : null);
      const deckDiag = getDiagnostics();

      const rect = deckCanvas ? deckCanvas.getBoundingClientRect() : null;
      
      setDiagnostics({
        mapInstanceId: map?._mapId ?? map?.getCanvas?.()?.id ?? 'unknown',
        mapContainerSize: mapContainer 
          ? { width: mapContainer.clientWidth, height: mapContainer.clientHeight }
          : null,
        deckCanvasSize: deckDiag.canvasDimensions,
        deckCanvasCssSize: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : deckDiag.canvasCssDimensions,
        devicePixelRatio: deckDiag.devicePixelRatio,
        deckCanvasZIndex: getComputedZIndex(deckCanvas),
        deckInitialized: deckDiag.initialized,
        deckLayerCount: deckDiag.layerCount,
        deckLayerIds: deckDiag.layerIds,
        overlayStatus: {
          ecostress: {
            enabled: overlays.ecostress.enabled,
            status: overlays.ecostress.metadata?.status as string | null ?? null,
            error: overlays.ecostress.error,
          },
          floodRisk: {
            enabled: overlays.floodRisk.enabled,
            status: overlays.floodRisk.metadata?.layers ? 'ok' : null,
            error: overlays.floodRisk.error,
          },
          airTemperature: {
            enabled: airTemperature.enabled,
            status: airTemperature.data ? 'ok' : airTemperature.loading ? 'loading' : null,
            error: airTemperature.error,
          },
          globalLST: {
            enabled: heatLayers.globalLSTEnabled && overlays.ecostress.enabled,
          },
        },
      });
    };
    
    updateDiagnostics();
    const interval = setInterval(updateDiagnostics, 2000);
    
    return () => clearInterval(interval);
  }, [visible, isOpen, mapRef, overlays, heatLayers, airTemperature]);
  
  if (!visible) return null;
  
  const StatusIcon = ({ ok }: { ok: boolean | null }) => {
    if (ok === null) return <XCircle className="h-3 w-3 text-muted-foreground" />;
    return ok 
      ? <CheckCircle className="h-3 w-3 text-green-500" />
      : <AlertCircle className="h-3 w-3 text-destructive" />;
  };
  
  // NOTE: canvas.width/height are device-pixel buffer sizes; compare DPR-aware.
  const cssSizeMismatch = diagnostics && diagnostics.mapContainerSize && diagnostics.deckCanvasCssSize && (
    Math.abs(diagnostics.mapContainerSize.width - diagnostics.deckCanvasCssSize.width) > 2 ||
    Math.abs(diagnostics.mapContainerSize.height - diagnostics.deckCanvasCssSize.height) > 2
  );

  const bufferSizeMismatch = diagnostics && diagnostics.mapContainerSize && diagnostics.deckCanvasSize && (
    Math.abs(diagnostics.mapContainerSize.width * diagnostics.devicePixelRatio - diagnostics.deckCanvasSize.width) > 64 ||
    Math.abs(diagnostics.mapContainerSize.height * diagnostics.devicePixelRatio - diagnostics.deckCanvasSize.height) > 64
  );

  const canvasSizeMismatch = !!(cssSizeMismatch || bufferSizeMismatch);
  
  return (
    <div className="absolute bottom-8 right-3 z-10">
      {/* Diagnostics Button */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'bg-background/90 backdrop-blur-sm border border-border shadow-lg',
          isOpen && 'bg-accent text-accent-foreground'
        )}
      >
        <Bug className="h-4 w-4 mr-1" />
        Diagnostics
      </Button>

      {/* Diagnostics Panel */}
      {isOpen && diagnostics && (
        <div className="absolute right-0 bottom-10 w-72 bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden text-xs font-mono">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Overlay Diagnostics</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="p-3 space-y-3 max-h-80 overflow-y-auto">
            {/* Map Instance */}
            <Section title="MapLibre Instance" icon={<Map className="h-3 w-3" />}>
              <Row label="Instance ID" value={diagnostics.mapInstanceId || '–'} />
              <Row 
                label="Container" 
                value={diagnostics.mapContainerSize 
                  ? `${diagnostics.mapContainerSize.width}×${diagnostics.mapContainerSize.height}` 
                  : '–'
                } 
              />
            </Section>
            
            {/* Deck.gl Canvas */}
            <Section 
              title="deck.gl Canvas" 
              icon={<StatusIcon ok={diagnostics.deckInitialized && !canvasSizeMismatch} />}
            >
              <Row label="Initialized" value={diagnostics.deckInitialized ? '✓' : '✗'} ok={diagnostics.deckInitialized} />
              <Row 
                label="CSS Size" 
                value={diagnostics.deckCanvasCssSize
                  ? `${diagnostics.deckCanvasCssSize.width}×${diagnostics.deckCanvasCssSize.height}`
                  : 'not found'
                }
                ok={!canvasSizeMismatch}
              />
              <Row
                label="Buffer"
                value={diagnostics.deckCanvasSize
                  ? `${diagnostics.deckCanvasSize.width}×${diagnostics.deckCanvasSize.height} (DPR ${diagnostics.devicePixelRatio})`
                  : '–'
                }
                ok={!canvasSizeMismatch}
              />
              <Row 
                label="z-index" 
                value={diagnostics.deckCanvasZIndex || '–'} 
                ok={diagnostics.deckCanvasZIndex ? parseInt(diagnostics.deckCanvasZIndex, 10) >= 5 : false}
              />
              <Row label="Layers" value={`${diagnostics.deckLayerCount} active`} />
              {diagnostics.deckLayerIds.length > 0 && (
                <div className="mt-1 text-[10px] text-muted-foreground break-all">
                  {diagnostics.deckLayerIds.join(', ')}
                </div>
              )}
            </Section>
            
            {/* Overlay Status */}
            <Section title="Overlays" icon={<Layers className="h-3 w-3" />}>
              <OverlayRow 
                name="Global LST (MODIS)" 
                enabled={diagnostics.overlayStatus.globalLST.enabled} 
                status={diagnostics.overlayStatus.globalLST.enabled ? 'active' : null}
              />
              <OverlayRow 
                name="ECOSTRESS" 
                enabled={diagnostics.overlayStatus.ecostress.enabled} 
                status={diagnostics.overlayStatus.ecostress.status}
                error={diagnostics.overlayStatus.ecostress.error}
              />
              <OverlayRow 
                name="DWD Air Temp" 
                enabled={diagnostics.overlayStatus.airTemperature.enabled} 
                status={diagnostics.overlayStatus.airTemperature.status}
                error={diagnostics.overlayStatus.airTemperature.error}
              />
              <OverlayRow 
                name="Flood Risk" 
                enabled={diagnostics.overlayStatus.floodRisk.enabled} 
                status={diagnostics.overlayStatus.floodRisk.status}
                error={diagnostics.overlayStatus.floodRisk.error}
              />
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper components
const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div>
    <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
      {icon}
      <span className="uppercase text-[10px] tracking-wide">{title}</span>
    </div>
    <div className="space-y-0.5">{children}</div>
  </div>
);

const Row: React.FC<{ label: string; value: string; ok?: boolean }> = ({ label, value, ok }) => (
  <div className="flex justify-between items-center">
    <span className="text-muted-foreground">{label}:</span>
    <span className={cn(
      ok === true && 'text-green-500',
      ok === false && 'text-destructive',
    )}>{value}</span>
  </div>
);

const OverlayRow: React.FC<{ name: string; enabled: boolean; status: string | null; error?: string | null }> = ({ 
  name, enabled, status, error 
}) => (
  <div className="flex items-center justify-between py-0.5">
    <span className={cn('text-muted-foreground', enabled && 'text-foreground')}>{name}</span>
    <div className="flex items-center gap-1">
      {!enabled && <span className="text-muted-foreground/60">off</span>}
      {enabled && status === 'match' && <CheckCircle className="h-3 w-3 text-green-500" />}
      {enabled && status === 'ok' && <CheckCircle className="h-3 w-3 text-green-500" />}
      {enabled && status === 'active' && <CheckCircle className="h-3 w-3 text-green-500" />}
      {enabled && status === 'loading' && (
        <div className="h-3 w-3 border border-primary/30 border-t-primary rounded-full animate-spin" />
      )}
      {enabled && status === 'no_coverage' && <AlertCircle className="h-3 w-3 text-amber-500" />}
      {enabled && error && <span title={error}><XCircle className="h-3 w-3 text-destructive" /></span>}
    </div>
  </div>
);

export default OverlayDiagnosticsPanel;
