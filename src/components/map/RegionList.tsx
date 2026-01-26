import React, { useState } from 'react';
import { useRegion } from '@/contexts/RegionContext';
import { ChevronDown, ChevronUp, MapPin, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

const RegionList: React.FC = () => {
  const {
    regions,
    selectedRegionId,
    setSelectedRegionId,
    comparisonRegionId,
    removeRegion,
    clearAllRegions,
  } = useRegion();

  const [isOpen, setIsOpen] = useState(false);

  if (regions.length === 0) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border-b border-border">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              Geladene Regionen ({regions.length})
            </span>
          </div>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={clearAllRegions}
          >
            <Trash2 className="mr-2 h-3 w-3" />
            Alle entfernen
          </Button>
        </div>
        <ScrollArea className="max-h-48">
          <div className="space-y-1 px-4 pb-4">
            {regions.map((region) => {
              const isSelected = region.id === selectedRegionId;
              const isComparison = region.id === comparisonRegionId;
              
              return (
                <div
                  key={region.id}
                  className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
                    isSelected
                      ? 'bg-accent/20 text-accent'
                      : isComparison
                      ? 'bg-primary/20 text-primary'
                      : 'hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <button
                    className="flex-1 truncate text-left"
                    onClick={() => setSelectedRegionId(isSelected ? null : region.id)}
                    title={region.name}
                  >
                    {region.name}
                    {isSelected && (
                      <span className="ml-2 text-xs opacity-70">(ausgewählt)</span>
                    )}
                    {isComparison && (
                      <span className="ml-2 text-xs opacity-70">(Vergleich)</span>
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRegion(region.id);
                    }}
                    title="Region entfernen"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default RegionList;
