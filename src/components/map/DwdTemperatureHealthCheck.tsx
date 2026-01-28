/**
 * DWD Temperature Layer Health Check Panel
 * 
 * Developer/admin component to verify the DWD HYRAS-DE temperature layer is working correctly.
 * Shows dataset metadata, raster bounds, statistics, and verification URLs.
 */

import React, { useState } from 'react';
import { Bug, CheckCircle, AlertCircle, ExternalLink, Copy, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMapLayers } from './MapLayersContext';
import { useDwdTemperature } from '@/hooks/useDwdTemperature';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, supabase } from '@/integrations/supabase/client';

interface HealthCheckProps {
  visible?: boolean;
}

export const DwdTemperatureHealthCheck: React.FC<HealthCheckProps> = ({ visible = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<number | null>(null);
  const [testJson, setTestJson] = useState<unknown>(null);
  const [testRaw, setTestRaw] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const { airTemperature } = useMapLayers();
  const { refetch } = useDwdTemperature();

  if (!visible) return null;

  const metadata = airTemperature.metadata;
  const data = airTemperature.data;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Build sample DWD URL for verification
  const year = metadata?.year || new Date().getFullYear() - 1;
  const variable = airTemperature.aggregation === 'daily_max' ? 'max' : 'mean';
  const sampleUrl = `https://opendata.dwd.de/climate_environment/CDC/grids_germany/seasonal/air_temperature_${variable}/14_JJA/grids_germany_seasonal_air_temp_${variable}_${year}14.asc.gz`;

  const healthEndpointUrl = `${SUPABASE_URL}/functions/v1/dwd-health`;

  const runHealthTest = async () => {
    setTestLoading(true);
    setTestStatus(null);
    setTestJson(null);
    setTestRaw(null);
    setTestError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch(healthEndpointUrl, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ year, variable }),
      });

      setTestStatus(res.status);

      const text = await res.text();
      setTestRaw(text);

      try {
        setTestJson(JSON.parse(text));
      } catch {
        setTestJson(null);
      }
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="absolute top-16 right-3 z-20">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="bg-background/90 backdrop-blur-sm text-xs"
      >
        <Bug className="h-3 w-3 mr-1" />
        DWD Health
      </Button>

      {isOpen && (
        <div className="absolute right-0 top-10 w-96 bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <h3 className="text-sm font-semibold">DWD Temperature Layer Health</h3>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsOpen(false)}>
              ×
            </Button>
          </div>

          <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto text-xs">
            {/* Status */}
            <div className="flex items-center gap-2">
              {airTemperature.error ? (
                <>
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-destructive font-medium">Error: {airTemperature.error}</span>
                </>
              ) : airTemperature.loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">Loading...</span>
                </>
              ) : data ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-green-600 dark:text-green-400 font-medium">Layer Active</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">Layer Disabled</span>
                </>
              )}
            </div>

            {/* Dataset Info */}
            <div className="space-y-2 p-3 rounded bg-muted/30 border border-border">
              <h4 className="font-medium text-foreground">Dataset Info</h4>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <span>Year/Season:</span>
                <span className="text-foreground">
                  {metadata?.year ?? year} / JJA (Jun–Aug)
                </span>
                <span>Variable:</span>
                <span className="text-foreground">
                  {airTemperature.aggregation === 'daily_max' ? 'Daily Max' : 'Daily Mean'}
                </span>
                <span>Resolution:</span>
                <span className="text-foreground">1 km × 1 km (HYRAS-DE)</span>
                <span>Period:</span>
                <span className="text-foreground">{metadata?.period ?? 'N/A'}</span>
              </div>
            </div>

            {/* Raster Bounds */}
            {data?.bounds && (
              <div className="space-y-2 p-3 rounded bg-muted/30 border border-border">
                <h4 className="font-medium text-foreground">Raster Bbox (WGS84)</h4>
                <div className="font-mono text-[10px] bg-background p-2 rounded border border-border">
                  [{data.bounds[0].toFixed(4)}, {data.bounds[1].toFixed(4)}, {data.bounds[2].toFixed(4)}, {data.bounds[3].toFixed(4)}]
                </div>
              </div>
            )}

            {/* Statistics */}
            {metadata?.normalization && (
              <div className="space-y-2 p-3 rounded bg-muted/30 border border-border">
                <h4 className="font-medium text-foreground">Statistics (°C)</h4>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <span>Min:</span>
                  <span className="text-foreground font-mono">{metadata.normalization.min?.toFixed(1) ?? 'N/A'}</span>
                  <span>Max:</span>
                  <span className="text-foreground font-mono">{metadata.normalization.max?.toFixed(1) ?? 'N/A'}</span>
                  <span>P5:</span>
                  <span className="text-foreground font-mono">{metadata.normalization.p5?.toFixed(1) ?? 'N/A'}</span>
                  <span>P95:</span>
                  <span className="text-foreground font-mono">{metadata.normalization.p95?.toFixed(1) ?? 'N/A'}</span>
                </div>
              </div>
            )}

            {/* Grid Cell Count */}
            <div className="space-y-2 p-3 rounded bg-muted/30 border border-border">
              <h4 className="font-medium text-foreground">Coverage</h4>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <span>Grid Cells:</span>
                <span className="text-foreground font-mono">
                  {metadata?.pointCount?.toLocaleString('de-DE') ?? 'N/A'}
                </span>
                <span>Enabled:</span>
                <span className="text-foreground">
                  {airTemperature.enabled ? 'Yes' : 'No'}
                </span>
                <span>Opacity:</span>
                <span className="text-foreground">{airTemperature.opacity}%</span>
              </div>
            </div>

            {/* Sample URL */}
            <div className="space-y-2 p-3 rounded bg-muted/30 border border-border">
              <h4 className="font-medium text-foreground">Source URL</h4>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[9px] p-2 bg-background rounded border border-border overflow-x-auto whitespace-nowrap">
                  {sampleUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => handleCopy(sampleUrl)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <a
                href={sampleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Test download (opens in new tab)
              </a>
              {copied && <span className="text-green-500 text-[10px]">Copied!</span>}
            </div>

            {/* Edge Function Health */}
            <div className="space-y-2 p-3 rounded bg-muted/30 border border-border">
              <h4 className="font-medium text-foreground">Edge Function Health</h4>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[9px] p-2 bg-background rounded border border-border overflow-x-auto whitespace-nowrap">
                    {healthEndpointUrl}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => handleCopy(healthEndpointUrl)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={runHealthTest}
                  disabled={testLoading}
                  className="w-full"
                >
                  <RefreshCw className={`h-3 w-3 mr-2 ${testLoading ? 'animate-spin' : ''}`} />
                  Test Edge Function
                </Button>

                {(testError || testStatus !== null) && (
                  <div className="space-y-2">
                    <div className="text-muted-foreground">
                      <span className="font-medium text-foreground">HTTP:</span>{' '}
                      {testStatus ?? '—'}
                      {testError ? (
                        <span className="text-destructive"> — {testError}</span>
                      ) : null}
                    </div>
                    <pre className="text-[10px] leading-relaxed bg-background border border-border rounded p-2 overflow-auto max-h-40">
                      {testJson ? JSON.stringify(testJson, null, 2) : (testRaw ?? '—')}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Refetch Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
              disabled={airTemperature.loading}
              className="w-full"
            >
              <RefreshCw className={`h-3 w-3 mr-2 ${airTemperature.loading ? 'animate-spin' : ''}`} />
              Refetch Data
            </Button>

            {/* Attribution */}
            <p className="text-[10px] text-muted-foreground/70 text-center">
              © Deutscher Wetterdienst (DWD), HYRAS-DE, CC BY 4.0
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DwdTemperatureHealthCheck;
