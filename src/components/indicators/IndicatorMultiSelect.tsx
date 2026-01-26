import React, { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAllIndicators, IndicatorOption } from '@/hooks/useAllIndicators';
import { useIndicatorSelection } from '@/hooks/useIndicatorSelection';

const IndicatorMultiSelect: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const { indicators, isLoading, error } = useAllIndicators();
  const { selectedCodes, toggleCode, selectAll, deselectAll, isSelected } = useIndicatorSelection();

  const filteredIndicators = useMemo(() => {
    if (!searchQuery.trim()) return indicators;
    const query = searchQuery.toLowerCase();
    return indicators.filter(
      (ind) =>
        ind.name.toLowerCase().includes(query) ||
        ind.code.toLowerCase().includes(query)
    );
  }, [indicators, searchQuery]);

  const allCodes = useMemo(() => indicators.map((i) => i.code), [indicators]);
  const allSelected = indicators.length > 0 && selectedCodes.size === indicators.length;
  const noneSelected = selectedCodes.size === 0;

  const handleSelectAll = () => {
    if (allSelected) {
      deselectAll();
    } else {
      selectAll(allCodes);
    }
  };

  return (
    <div className="px-4 py-3 border-b border-border">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Indikatoren
      </p>
      
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between text-left font-normal h-9 bg-background border-border hover:bg-muted/50"
          >
            <span className="truncate text-sm">
              {selectedCodes.size === 0
                ? 'Keine ausgewählt'
                : selectedCodes.size === indicators.length
                ? 'Alle ausgewählt'
                : `${selectedCodes.size} ausgewählt`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        
        <PopoverContent 
          className="w-72 p-0 bg-popover border-border z-50" 
          align="start"
          sideOffset={4}
        >
          {/* Search Input */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Suchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm bg-background border-border"
              />
            </div>
          </div>

          {/* Select All / Deselect All */}
          <div className="p-2 border-b border-border flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={() => selectAll(allCodes)}
              disabled={allSelected || isLoading}
            >
              Alle auswählen
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={deselectAll}
              disabled={noneSelected || isLoading}
            >
              Alle abwählen
            </Button>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="p-4 text-center">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Indicator List */}
          {!isLoading && !error && (
            <ScrollArea className="h-64">
              <div className="p-2">
                {filteredIndicators.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Keine Indikatoren gefunden
                  </p>
                ) : (
                  filteredIndicators.map((indicator) => (
                    <label
                      key={indicator.code}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={isSelected(indicator.code)}
                        onCheckedChange={() => toggleCode(indicator.code)}
                        className="h-4 w-4"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate text-foreground">
                          {indicator.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {indicator.code} · {indicator.unit}
                        </p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </ScrollArea>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default IndicatorMultiSelect;
