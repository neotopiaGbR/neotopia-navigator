import React, { useState } from 'react';
import { useRegion } from '@/contexts/RegionContext';
import { useClimateIndicators } from '@/hooks/useClimateIndicators';
import { ClimateScenario, ClimateTimeHorizon, CLIMATE_CATEGORY_LABELS, CLIMATE_INDICATORS } from './types';
import ClimateScenarioSelector from './ClimateScenarioSelector';
import ClimateTimeHorizonSelector from './ClimateTimeHorizonSelector';
import ClimateIndicatorCard from './ClimateIndicatorCard';
import ClimateAnalogCard from './ClimateAnalogCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Thermometer, CloudSun, Info } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

const ClimateProjectionPanel: React.FC = () => {
  const { selectedRegion, selectedRegionId } = useRegion();
  
  const [scenario, setScenario] = useState<ClimateScenario>('ssp245');
  const [timeHorizon, setTimeHorizon] = useState<ClimateTimeHorizon>('2031-2060');

  const { data, climateAnalog, isLoading, hasData } = useClimateIndicators(
    selectedRegionId,
    scenario,
    timeHorizon
  );

  // Group indicators by category
  const groupedData = React.useMemo(() => {
    const groups: Record<string, typeof data> = {
      heat: [],
      extremes: [],
      water: [],
    };

    for (const item of data) {
      const category = item.indicator.category;
      if (groups[category]) {
        groups[category].push(item);
      }
    }

    return groups;
  }, [data]);

  // If no region selected
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

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

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
        <ClimateScenarioSelector
          value={scenario}
          onChange={setScenario}
        />
        <ClimateTimeHorizonSelector
          value={timeHorizon}
          onChange={setTimeHorizon}
          disabled={scenario === 'baseline'}
        />
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Empty state */}
          {!hasData && (
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
              <CloudSun className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Klimaprojektionen werden hier angezeigt, sobald Daten geladen sind.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Datenquellen: Copernicus ERA5-Land, CMIP6
              </p>
            </div>
          )}

          {/* Climate Analog Card */}
          {(hasData || scenario !== 'baseline') && (
            <ClimateAnalogCard result={climateAnalog} />
          )}

          {/* Indicator Cards by Category */}
          {hasData && (
            <>
              {(['heat', 'extremes', 'water'] as const).map((category) => {
                const categoryData = groupedData[category];
                if (categoryData.length === 0) return null;

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
          <div className="rounded-md bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium">Datenquellen:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  <li>Baseline: Copernicus ERA5-Land (1991–2020)</li>
                  <li>Projektionen: CMIP6 (SSP-Szenarien)</li>
                  <li>Auflösung: 1 km EU-Raster (EPSG:3035)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default ClimateProjectionPanel;
