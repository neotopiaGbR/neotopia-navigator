import React, { useState } from 'react';
import { useRegionIndicators, RegionIndicatorData } from '@/hooks/useRegionIndicators';
import IndicatorCard from './IndicatorCard';
import IndicatorChartDialog from './IndicatorChartDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3, AlertCircle } from 'lucide-react';

interface IndicatorsPanelProps {
  regionId: string | null;
  regionName: string | null;
}

const IndicatorsPanel: React.FC<IndicatorsPanelProps> = ({ regionId, regionName }) => {
  const { data, isLoading, error } = useRegionIndicators(regionId);
  const [selectedIndicator, setSelectedIndicator] = useState<RegionIndicatorData | null>(null);
  const [chartOpen, setChartOpen] = useState(false);

  const handleCardClick = (indicator: RegionIndicatorData) => {
    setSelectedIndicator(indicator);
    setChartOpen(true);
  };

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

  if (isLoading) {
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

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Indikatoren
          </p>
          <span className="text-xs text-muted-foreground">{data.length} verfügbar</span>
        </div>
        <div className="grid gap-3">
          {data.map((item) => (
            <IndicatorCard
              key={item.indicator.id}
              data={item}
              onClick={() => handleCardClick(item)}
            />
          ))}
        </div>
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
