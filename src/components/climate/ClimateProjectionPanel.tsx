/**
 * ClimateProjectionPanel
 * 
 * STABLE VERSION - Full audit completed
 * 
 * Displays climate projections for selected region.
 * Guarantees:
 * - Never hangs in loading state
 * - Always shows error OR data OR empty state
 * - Retry button on failure
 */

import React, { useState } from 'react';
import { useRegion } from '@/contexts/RegionContext';
import { useClimateIndicators } from '@/hooks/useClimateIndicators';
import {
  ClimateScenario,
  ClimateTimeHorizon,
  CLIMATE_CATEGORY_LABELS,
  CLIMATE_DATA_ATTRIBUTION,
  ClimateIndicatorCategory,
} from './types';
import ClimateScenarioSelector from './ClimateScenarioSelector';
import ClimateTimeHorizonSelector from './ClimateTimeHorizonSelector';
import ClimateIndicatorCard from './ClimateIndicatorCard';
import ClimateAnalogCard from './ClimateAnalogCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Thermometer, CloudSun, Info, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const CATEGORY_ORDER: ClimateIndicatorCategory[] = ['temperature', 'heat', 'thermal', 'energy', 'precipitation', 'drought', 'extremes', 'urban'];

const ClimateProjectionPanel: React.FC = () => {
  const { selectedRegion, selectedRegionId } = useRegion();

  const [scenario, setScenario] = useState<ClimateScenario>('ssp245');
  const [timeHorizon, setTimeHorizon] = useState<ClimateTimeHorizon>('near');
  const [showAttribution, setShowAttribution] = useState(false);

  const { data, climateAnalog, isLoading, error, hasData, refetch } = useClimateIndicators(
    selectedRegionId,
    scenario,
    timeHorizon
  );

  // Group indicators by category
  const groupedData = React.useMemo(() => {
    const groups: Record<ClimateIndicatorCategory, typeof data> = {
      temperature: [],
      heat: [],
      extremes: [],
      precipitation: [],
      drought: [],
      thermal: [],
      energy: [],
      urban: [],
      analog: [],
    };

    for (const item of data) {
      const category = item.indicator.category;
      if (groups[category]) {
        groups[category].push(item);
      }
    }

    return groups;
  }, [data]);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: No region selected
  // ─────────────────────────────────────────────────────────────────────────────

  if (!selectedRegionId) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center">
        <CloudSun className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Wählen Sie eine Region, um Klimaprojektionen anzuzeigen
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: Loading state
  // ─────────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">Klimaprojektionen</h3>
          </div>
          {selectedRegion && (
            <p className="mt-1 text-xs text-muted-foreground">
              Region: {selectedRegion.name}
            </p>
          )}
        </div>

        {/* Loading skeleton */}
        <div className="space-y-4 p-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-md" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: Error state
  // ─────────────────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">Klimaprojektionen</h3>
          </div>
          {selectedRegion && (
            <p className="mt-1 text-xs text-muted-foreground">
              Region: {selectedRegion.name}
            </p>
          )}
        </div>

        {/* Error message */}
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive/70" />
          <p className="mb-1 text-sm font-medium text-destructive">Fehler beim Laden</p>
          <p className="mb-4 max-w-xs text-xs text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Erneut versuchen
          </Button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: Main content
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">Klimaprojektionen</h3>
        </div>
        {selectedRegion && (
          <p className="mt-1 text-xs text-muted-foreground">
            Region: {selectedRegion.name}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="shrink-0 space-y-3 border-b border-border p-4">
        <ClimateScenarioSelector value={scenario} onChange={setScenario} />
        <ClimateTimeHorizonSelector
          value={timeHorizon}
          onChange={setTimeHorizon}
          disabled={scenario === 'historical'}
        />
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Empty state - no data available */}
          {!hasData && (
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
              <CloudSun className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Keine Klimadaten für diese Region verfügbar.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Datenquellen: Copernicus ERA5-Land, EURO-CORDEX
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={refetch}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Erneut laden
              </Button>
            </div>
          )}

          {/* Climate Analog Card */}
          {(hasData || scenario !== 'historical') && (
            <ClimateAnalogCard result={climateAnalog} />
          )}

          {/* Indicator Cards by Category */}
          {hasData && (
            <>
              {CATEGORY_ORDER.map((category) => {
                const categoryData = groupedData[category];
                if (!categoryData || categoryData.length === 0) return null;

                return (
                  <div key={category}>
                    <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {CLIMATE_CATEGORY_LABELS[category]}
                    </h4>
                    <div className="space-y-2">
                      {categoryData.map((item) => (
                        <ClimateIndicatorCard key={item.indicator.code} data={item} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Data sources info */}
          <Collapsible open={showAttribution} onOpenChange={setShowAttribution}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs">
                <Info className="mr-2 h-3.5 w-3.5" />
                Datenquellen & Lizenzen
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
                <div className="space-y-3">
                  <div>
                    <p className="font-medium text-foreground">Baseline (1991–2020)</p>
                    <p>{CLIMATE_DATA_ATTRIBUTION.baseline.source}</p>
                    <p>{CLIMATE_DATA_ATTRIBUTION.baseline.dataset}</p>
                    <p>Lizenz: {CLIMATE_DATA_ATTRIBUTION.baseline.license}</p>
                    <a
                      href={CLIMATE_DATA_ATTRIBUTION.baseline.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      Datensatz
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Projektionen</p>
                    <p>{CLIMATE_DATA_ATTRIBUTION.projections.source}</p>
                    <p>{CLIMATE_DATA_ATTRIBUTION.projections.dataset}</p>
                    <p>Szenarien: {CLIMATE_DATA_ATTRIBUTION.projections.scenarios.join(', ')}</p>
                    <p>Lizenz: {CLIMATE_DATA_ATTRIBUTION.projections.license}</p>
                    <a
                      href={CLIMATE_DATA_ATTRIBUTION.projections.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      Datensatz
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  );
};

export default ClimateProjectionPanel;
