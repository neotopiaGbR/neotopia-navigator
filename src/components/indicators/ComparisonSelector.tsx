import React from 'react';
import { useRegion } from '@/contexts/RegionContext';
import { GitCompare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ComparisonSelector: React.FC = () => {
  const {
    regions,
    selectedRegionId,
    comparisonMode,
    setComparisonMode,
    comparisonRegionId,
    setComparisonRegionId,
    comparisonRegion,
  } = useRegion();

  // Filter out the currently selected region from comparison options
  const availableRegions = regions.filter((r) => r.id !== selectedRegionId);

  if (!selectedRegionId) {
    return null;
  }

  return (
    <div className="px-4 py-3 border-b border-border">
      {/* Toggle Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Vergleich
          </span>
        </div>
        <Switch
          checked={comparisonMode}
          onCheckedChange={setComparisonMode}
          className="data-[state=checked]:bg-accent"
        />
      </div>

      {/* Region Selector (when enabled) */}
      {comparisonMode && (
        <div className="space-y-2">
          {availableRegions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Keine weiteren Regionen verfügbar
            </p>
          ) : (
            <>
              <Select
                value={comparisonRegionId ?? ''}
                onValueChange={(value) => setComparisonRegionId(value || null)}
              >
                <SelectTrigger className="h-9 bg-background border-border text-sm">
                  <SelectValue placeholder="Region zum Vergleichen wählen" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border z-50">
                  {availableRegions.map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {region.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {comparisonRegion && (
                <div className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1.5">
                  <span className="text-xs text-foreground truncate">
                    vs. <span className="font-medium text-accent">{comparisonRegion.name}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-muted-foreground hover:text-foreground"
                    onClick={() => setComparisonRegionId(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ComparisonSelector;
