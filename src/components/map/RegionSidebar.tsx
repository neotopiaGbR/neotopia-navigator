import React from 'react';
import { useRegion } from '@/contexts/RegionContext';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import IndicatorsPanel from '@/components/indicators/IndicatorsPanel';
import IndicatorMultiSelect from '@/components/indicators/IndicatorMultiSelect';
import ComparisonSelector from '@/components/indicators/ComparisonSelector';
import AddressSearch from './AddressSearch';
import RegionList from './RegionList';

const RegionSidebar: React.FC = () => {
  const { selectedRegion, setSelectedRegionId } = useRegion();

  return (
    <div className="flex h-full w-80 flex-col border-r border-border bg-card">
      {/* Address Search */}
      <AddressSearch />

      {/* Loaded Regions List */}
      <RegionList />

      {/* Selected Region Header */}
      {selectedRegion && (
        <div className="shrink-0 border-b border-border p-4">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Ausgewählt
              </p>
              <h3 className="mt-1 truncate text-lg font-bold text-accent">
                {selectedRegion.name}
              </h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="ml-2 h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedRegionId(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Comparison Selector */}
      <ComparisonSelector />

      {/* Indicator Multi-Select */}
      <IndicatorMultiSelect />

      {/* Indicators Panel */}
      <IndicatorsPanel
        regionId={selectedRegion?.id ?? null}
        regionName={selectedRegion?.name ?? null}
      />
    </div>
  );
};

export default RegionSidebar;
