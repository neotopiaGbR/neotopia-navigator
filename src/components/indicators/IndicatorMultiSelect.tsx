import React, { useState, useMemo } from 'react';
import { ChevronsUpDown, Search, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAllIndicators, IndicatorsByDomain } from '@/hooks/useAllIndicators';
import { useIndicatorSelection } from '@/hooks/useIndicatorSelection';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const IndicatorMultiSelect: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  
  const { indicators, indicatorsByDomain, isLoading, error } = useAllIndicators();
  const { selectedCodes, toggleCode, selectAll, deselectAll, isSelected } = useIndicatorSelection();

  // Filter indicators based on search
  const filteredByDomain = useMemo(() => {
    if (!searchQuery.trim()) return indicatorsByDomain;
    
    const query = searchQuery.toLowerCase();
    const filtered: IndicatorsByDomain[] = [];
    
    for (const group of indicatorsByDomain) {
      const matchingIndicators = group.indicators.filter(
        (ind) =>
          ind.name.toLowerCase().includes(query) ||
          ind.code.toLowerCase().includes(query) ||
          (ind.description?.toLowerCase().includes(query))
      );
      if (matchingIndicators.length > 0) {
        filtered.push({
          domain: group.domain,
          label: group.label,
          indicators: matchingIndicators,
        });
      }
    }
    return filtered;
  }, [indicatorsByDomain, searchQuery]);

  // Expand all domains when searching
  React.useEffect(() => {
    if (searchQuery.trim()) {
      setExpandedDomains(new Set(filteredByDomain.map((g) => g.domain)));
    }
  }, [searchQuery, filteredByDomain]);

  const allCodes = useMemo(() => indicators.map((i) => i.code), [indicators]);
  const allSelected = indicators.length > 0 && selectedCodes.size === indicators.length;
  const noneSelected = selectedCodes.size === 0;

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const selectAllInDomain = (domainIndicators: { code: string }[]) => {
    const codes = domainIndicators.map((i) => i.code);
    const newSelection = new Set(selectedCodes);
    for (const code of codes) {
      newSelection.add(code);
    }
    selectAll(Array.from(newSelection));
  };

  const getDomainSelectionState = (domainIndicators: { code: string }[]) => {
    const codes = domainIndicators.map((i) => i.code);
    const selectedCount = codes.filter((c) => selectedCodes.has(c)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === codes.length) return 'all';
    return 'partial';
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
          className="w-80 p-0 bg-popover border-border z-50" 
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

          {/* Grouped Indicator List */}
          {!isLoading && !error && (
            <ScrollArea className="h-72">
              <div className="p-1">
                {filteredByDomain.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Keine Indikatoren gefunden
                  </p>
                ) : (
                  filteredByDomain.map((group) => {
                    const isExpanded = expandedDomains.has(group.domain);
                    const selectionState = getDomainSelectionState(group.indicators);
                    
                    return (
                      <Collapsible
                        key={group.domain}
                        open={isExpanded}
                        onOpenChange={() => toggleDomain(group.domain)}
                      >
                        <div className="flex items-center gap-1 px-1 py-1">
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 hover:bg-muted/50"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                          
                          <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-accent">
                            {group.label}
                          </span>
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectAllInDomain(group.indicators);
                            }}
                            disabled={selectionState === 'all'}
                          >
                            Alle
                          </Button>
                          
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {group.indicators.filter((i) => selectedCodes.has(i.code)).length}/{group.indicators.length}
                          </span>
                        </div>
                        
                        <CollapsibleContent>
                          <div className="ml-2 border-l border-border/50 pl-2">
                            {group.indicators.map((indicator) => (
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
                                    {indicator.code} · {indicator.unit || '–'}
                                  </p>
                                </div>
                              </label>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })
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
