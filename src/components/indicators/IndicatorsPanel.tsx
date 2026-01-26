import React, { useState, useEffect, useMemo } from 'react';
import { useRegionIndicators, RegionIndicatorData } from '@/hooks/useRegionIndicators';
import { useRegion } from '@/contexts/RegionContext';
import { useIndicatorSelection } from '@/hooks/useIndicatorSelection';
import IndicatorCard from './IndicatorCard';
import ComparisonIndicatorCard from './ComparisonIndicatorCard';
import IndicatorChartDialog from './IndicatorChartDialog';
import YearSelector from './YearSelector';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3, AlertCircle, Filter, GitCompare } from 'lucide-react';

interface IndicatorsPanelProps {
  regionId: string | null;
  regionName: string | null;
}

const IndicatorsPanel: React.FC<IndicatorsPanelProps> = ({ regionId, regionName }) => {
  const { 
    selectedYear, 
    setSelectedYear, 
    setAvailableYears,
    comparisonMode,
    comparisonRegionId,
    comparisonRegion,
  } = useRegion();
  
  const { data, isLoading, error, availableYears } = useRegionIndicators(regionId, selectedYear);
  const { 
    data: comparisonData, 
    isLoading: comparisonLoading, 
    error: comparisonError 
  } = useRegionIndicators(
    comparisonMode ? comparisonRegionId : null, 
    selectedYear
  );
  
  const { selectedCodes } = useIndicatorSelection();
  const [selectedIndicator, setSelectedIndicator] = useState<RegionIndicatorData | null>(null);
  const [chartOpen, setChartOpen] = useState(false);

  // Filter data based on selected indicator codes
  const filteredData = useMemo(() => {
    if (selectedCodes.size === 0) return [];
    return data.filter((item) => selectedCodes.has(item.indicator.code));
  }, [data, selectedCodes]);

  // Create a map for quick lookup of comparison data by indicator code
  const comparisonDataMap = useMemo(() => {
    const map = new Map<string, RegionIndicatorData>();
    for (const item of comparisonData) {
      map.set(item.indicator.code, item);
    }
    return map;
  }, [comparisonData]);

  // Sync available years to context and set default year
  useEffect(() => {
    setAvailableYears(availableYears);
    if (availableYears.length > 0 && selectedYear === null) {
      // Default to latest year
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear, setSelectedYear, setAvailableYears]);

  const handleCardClick = (indicator: RegionIndicatorData) => {
    setSelectedIndicator(indicator);
    setChartOpen(true);
  };

  const isComparisonActive = comparisonMode && comparisonRegionId;
  const isAnyLoading = isLoading || (isComparisonActive && comparisonLoading);

  if (!regionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <BarChart3 className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Wählen Sie eine Region, um Indikatoren anzuzeigen
        </p>
      </div>
    );
  }

  if (isAnyLoading) {
    return (
      <div className="flex-1 space-y-3 p-4">
        <Skeleton className="h-4 w-24" />
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="mb-3 h-8 w-8 text-destructive/70" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <BarChart3 className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Keine Indikatoren für diese Region verfügbar
        </p>
      </div>
    );
  }

  // No indicators selected via multi-select
  if (selectedCodes.size === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <Filter className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Bitte Indikatoren auswählen.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        {/* Header with Year Selector */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isComparisonActive && (
              <GitCompare className="h-4 w-4 text-accent" />
            )}
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isComparisonActive ? 'Vergleich' : 'Indikatoren'}
            </p>
          </div>
          {availableYears.length > 1 && (
            <YearSelector
              years={availableYears}
              selectedYear={selectedYear}
              onYearChange={setSelectedYear}
            />
          )}
        </div>
        
        {/* Indicator count */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {filteredData.length} von {data.length} angezeigt
          </span>
          {selectedYear && (
            <span className="text-xs text-accent">Jahr {selectedYear}</span>
          )}
        </div>

        {/* Comparison error warning */}
        {isComparisonActive && comparisonError && (
          <div className="mb-3 rounded-md bg-destructive/10 p-2">
            <p className="text-xs text-destructive">
              Vergleichsdaten: {comparisonError}
            </p>
          </div>
        )}

        {filteredData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Filter className="mb-3 h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Keine passenden Indikatoren gefunden
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredData.map((item) => (
              isComparisonActive ? (
                <ComparisonIndicatorCard
                  key={item.indicator.id}
                  primaryData={item}
                  comparisonData={comparisonDataMap.get(item.indicator.code) ?? null}
                  primaryRegionName={regionName ?? ''}
                  comparisonRegionName={comparisonRegion?.name ?? null}
                  selectedYear={selectedYear}
                  onClick={() => handleCardClick(item)}
                />
              ) : (
                <IndicatorCard
                  key={item.indicator.id}
                  data={item}
                  selectedYear={selectedYear}
                  onClick={() => handleCardClick(item)}
                />
              )
            ))}
          </div>
        )}
      </div>

      <IndicatorChartDialog
        open={chartOpen}
        onOpenChange={setChartOpen}
        data={selectedIndicator}
        regionName={regionName}
      />
    </>
  );
};

export default IndicatorsPanel;
