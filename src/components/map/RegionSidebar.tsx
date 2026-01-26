import React, { useState } from 'react';
import { useRegion } from '@/contexts/RegionContext';
import { X, BarChart3, Thermometer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import IndicatorsPanel from '@/components/indicators/IndicatorsPanel';
import IndicatorMultiSelect from '@/components/indicators/IndicatorMultiSelect';
import ComparisonSelector from '@/components/indicators/ComparisonSelector';
import ClimateProjectionPanel from '@/components/climate/ClimateProjectionPanel';
import AddressSearch from './AddressSearch';
import RegionList from './RegionList';

const RegionSidebar: React.FC = () => {
  const { selectedRegion, setSelectedRegionId } = useRegion();
  const [activeTab, setActiveTab] = useState<'indicators' | 'climate'>('indicators');

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

      {/* Tabs for Indicators vs Climate */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'indicators' | 'climate')} className="flex flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border px-4 pt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="indicators" className="gap-1.5 text-xs">
              <BarChart3 className="h-3.5 w-3.5" />
              Indikatoren
            </TabsTrigger>
            <TabsTrigger value="climate" className="gap-1.5 text-xs">
              <Thermometer className="h-3.5 w-3.5" />
              Klima
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="indicators" className="mt-0 flex flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          {/* Comparison Selector */}
          <ComparisonSelector />

          {/* Indicator Multi-Select */}
          <IndicatorMultiSelect />

          {/* Indicators Panel */}
          <IndicatorsPanel
            regionId={selectedRegion?.id ?? null}
            regionName={selectedRegion?.name ?? null}
          />
        </TabsContent>

        <TabsContent value="climate" className="mt-0 flex flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          <ClimateProjectionPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RegionSidebar;
