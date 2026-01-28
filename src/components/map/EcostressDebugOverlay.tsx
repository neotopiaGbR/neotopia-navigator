/**
 * ECOSTRESS Debug Overlay
 * Shows diagnostic information for tile rendering (admin only)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bug, RefreshCw, X, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMapLayers } from './MapLayersContext';
import { useAuth } from '@/contexts/AuthContext';

interface TileRequest {
  url: string;
  status: number;
  mode: 'render' | 'fallback' | 'error' | 'unknown';
  reason: string;
  bytes?: number;
  stats?: string;
  timestamp: Date;
}

const EcostressDebugOverlay: React.FC = () => {
  const { overlays } = useMapLayers();
  const { profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [requests, setRequests] = useState<TileRequest[]>([]);
  const [summary, setSummary] = useState({ render: 0, fallback: 0, error: 0 });

  // Only show for admins and when ECOSTRESS is enabled
  const isAdmin = profile?.role === 'admin';
  const isEnabled = overlays.ecostress.enabled;

  // Intercept network requests to ecostress-tiles
  const interceptRequests = useCallback(() => {
    const originalFetch = window.fetch;
    
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
      
      if (url.includes('ecostress-tiles')) {
        const mode = response.headers.get('X-ECOSTRESS-Mode') as TileRequest['mode'] || 'unknown';
        const reason = response.headers.get('X-ECOSTRESS-Reason') || '';
        const bytes = parseInt(response.headers.get('X-ECOSTRESS-Bytes') || '0', 10);
        const stats = response.headers.get('X-ECOSTRESS-Stats') || '';
        
        const newRequest: TileRequest = {
          url: url.substring(0, 100),
          status: response.status,
          mode,
          reason,
          bytes,
          stats,
          timestamp: new Date(),
        };
        
        setRequests(prev => [...prev.slice(-19), newRequest]); // Keep last 20
        setSummary(prev => ({
          ...prev,
          [mode]: (prev[mode as keyof typeof prev] || 0) + 1,
        }));
      }
      
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    if (isAdmin && isEnabled) {
      const cleanup = interceptRequests();
      return cleanup;
    }
  }, [isAdmin, isEnabled, interceptRequests]);

  // Clear history
  const clearHistory = () => {
    setRequests([]);
    setSummary({ render: 0, fallback: 0, error: 0 });
  };

  if (!isAdmin || !isEnabled) return null;

  return (
    <>
      {/* Debug Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="absolute top-3 left-3 z-20 bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-800/30"
      >
        <Bug className="h-4 w-4 mr-1 text-yellow-600" />
        Debug
        {(summary.error > 0 || summary.fallback > summary.render) && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
            {summary.error + summary.fallback}
          </span>
        )}
      </Button>

      {/* Debug Panel */}
      {isOpen && (
        <div className="absolute top-12 left-3 z-20 w-96 max-h-[60vh] bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-yellow-100 dark:bg-yellow-900/30 border-b border-border">
            <h3 className="text-sm font-semibold">ECOSTRESS Tile Diagnostics</h3>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearHistory}>
                <RefreshCw className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsOpen(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Summary */}
          <div className="px-4 py-3 border-b border-border grid grid-cols-3 gap-2 text-center">
            <div className="flex flex-col items-center">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-lg font-bold text-green-600">{summary.render}</span>
              <span className="text-[10px] text-muted-foreground">Rendered</span>
            </div>
            <div className="flex flex-col items-center">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span className="text-lg font-bold text-yellow-600">{summary.fallback}</span>
              <span className="text-[10px] text-muted-foreground">Fallback</span>
            </div>
            <div className="flex flex-col items-center">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-lg font-bold text-red-600">{summary.error}</span>
              <span className="text-[10px] text-muted-foreground">Errors</span>
            </div>
          </div>

          {/* COG URL */}
          {overlays.ecostress.metadata?.cogUrl && (
            <div className="px-4 py-2 border-b border-border bg-muted/30">
              <p className="text-[10px] text-muted-foreground break-all">
                <strong>COG:</strong> {String(overlays.ecostress.metadata.cogUrl).substring(0, 80)}...
              </p>
            </div>
          )}

          {/* Request Log */}
          <div className="max-h-48 overflow-y-auto">
            {requests.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                Pan/zoom map to see tile requests
              </div>
            ) : (
              <div className="divide-y divide-border">
                {requests.slice().reverse().map((req, i) => (
                  <div key={i} className="px-4 py-2 text-xs hover:bg-muted/30">
                    <div className="flex items-center gap-2">
                      {req.mode === 'render' && <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />}
                      {req.mode === 'fallback' && <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />}
                      {(req.mode === 'error' || req.mode === 'unknown') && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                      <span className={
                        req.mode === 'render' ? 'text-green-600' :
                        req.mode === 'fallback' ? 'text-yellow-600' : 'text-red-600'
                      }>
                        {req.status} — {req.reason || req.mode}
                      </span>
                      {req.bytes > 0 && (
                        <span className="text-muted-foreground ml-auto">{req.bytes} bytes</span>
                      )}
                    </div>
                    {req.stats && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 pl-5">{req.stats}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verification Instructions */}
          <div className="px-4 py-3 border-t border-border bg-muted/20">
            <p className="text-[10px] text-muted-foreground">
              <strong>Verification:</strong> Check DevTools → Network for <code>ecostress-tiles</code> requests.
              <br />✓ <strong>X-ECOSTRESS-Mode: render</strong> = actual raster
              <br />⚠ <strong>X-ECOSTRESS-Mode: fallback</strong> = transparent (no data)
              <br />✗ <strong>500 error</strong> = function crash
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default EcostressDebugOverlay;
