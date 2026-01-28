/**
 * ECOSTRESS Debug Overlay
 * Shows diagnostic information for COG loading (admin only)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bug, RefreshCw, X, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMapLayers } from './MapLayersContext';
import { useAuth } from '@/contexts/AuthContext';

interface ProxyRequest {
  url: string;
  status: number;
  contentRange?: string;
  contentLength?: string;
  timestamp: Date;
  error?: string;
}

const EcostressDebugOverlay: React.FC = () => {
  const { overlays } = useMapLayers();
  const { profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [requests, setRequests] = useState<ProxyRequest[]>([]);
  const [summary, setSummary] = useState({ success: 0, partial: 0, error: 0 });

  // Only show for admins and when ECOSTRESS is enabled
  const isAdmin = profile?.role === 'admin';
  const isEnabled = overlays.ecostress.enabled;

  // Intercept network requests to ecostress-proxy
  const interceptRequests = useCallback(() => {
    const originalFetch = window.fetch;
    
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
      
      if (url.includes('ecostress-proxy')) {
        const contentRange = response.headers.get('Content-Range') || '';
        const contentLength = response.headers.get('Content-Length') || '';
        
        const newRequest: ProxyRequest = {
          url: url.substring(0, 80),
          status: response.status,
          contentRange,
          contentLength,
          timestamp: new Date(),
        };
        
        setRequests(prev => [...prev.slice(-19), newRequest]); // Keep last 20
        
        // Update summary
        if (response.status === 206) {
          setSummary(prev => ({ ...prev, partial: prev.partial + 1 }));
        } else if (response.status >= 200 && response.status < 300) {
          setSummary(prev => ({ ...prev, success: prev.success + 1 }));
        } else {
          setSummary(prev => ({ ...prev, error: prev.error + 1 }));
        }
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
    setSummary({ success: 0, partial: 0, error: 0 });
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
        {summary.error > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
            {summary.error}
          </span>
        )}
      </Button>

      {/* Debug Panel */}
      {isOpen && (
        <div className="absolute top-12 left-3 z-20 w-96 max-h-[60vh] bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-yellow-100 dark:bg-yellow-900/30 border-b border-border">
            <h3 className="text-sm font-semibold">ECOSTRESS Proxy Diagnostics</h3>
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
              <span className="text-lg font-bold text-green-600">{summary.success}</span>
              <span className="text-[10px] text-muted-foreground">200 OK</span>
            </div>
            <div className="flex flex-col items-center">
              <AlertTriangle className="h-4 w-4 text-blue-500" />
              <span className="text-lg font-bold text-blue-600">{summary.partial}</span>
              <span className="text-[10px] text-muted-foreground">206 Partial</span>
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
                Enable heat overlay to see proxy requests
              </div>
            ) : (
              <div className="divide-y divide-border">
                {requests.slice().reverse().map((req, i) => (
                  <div key={i} className="px-4 py-2 text-xs hover:bg-muted/30">
                    <div className="flex items-center gap-2">
                      {req.status === 206 && <AlertTriangle className="h-3 w-3 text-blue-500 shrink-0" />}
                      {req.status >= 200 && req.status < 300 && req.status !== 206 && <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />}
                      {req.status >= 400 && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                      <span className={
                        req.status === 206 ? 'text-blue-600' :
                        req.status >= 200 && req.status < 300 ? 'text-green-600' : 'text-red-600'
                      }>
                        {req.status}
                      </span>
                      {req.contentLength && (
                        <span className="text-muted-foreground ml-auto">
                          {parseInt(req.contentLength).toLocaleString()} bytes
                        </span>
                      )}
                    </div>
                    {req.contentRange && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 pl-5 font-mono">
                        {req.contentRange}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verification Instructions */}
          <div className="px-4 py-3 border-t border-border bg-muted/20">
            <p className="text-[10px] text-muted-foreground">
              <strong>Verification:</strong> Check DevTools → Network for <code>ecostress-proxy</code> requests.
              <br />✓ <strong>206 Partial Content</strong> = Range requests working (COG)
              <br />✓ <strong>200 OK</strong> = Full file fetched
              <br />✗ <strong>4xx/5xx</strong> = Auth or fetch error
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default EcostressDebugOverlay;
