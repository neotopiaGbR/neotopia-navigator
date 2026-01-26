import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, MapPin, Loader2, Grid3X3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useRegion } from '@/contexts/RegionContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface GridResult {
  region_id: string;
  grid_code: string;
}

type TargetRegion = 'primary' | 'comparison';

const AddressSearch: React.FC = () => {
  const {
    setSelectedRegionId,
    comparisonMode,
    setComparisonRegionId,
  } = useRegion();

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreatingGrid, setIsCreatingGrid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gridCode, setGridCode] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [targetRegion, setTargetRegion] = useState<TargetRegion>('primary');

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Nominatim search with debounce
  const searchNominatim = useCallback(async (searchQuery: string, signal: AbortSignal) => {
    if (searchQuery.length < 3) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&addressdetails=1`,
        {
          signal,
          headers: {
            'Accept-Language': 'de',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Nominatim request failed');
      }

      const data: NominatimResult[] = await response.json();
      setSuggestions(data);
      setShowSuggestions(data.length > 0);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('Adresssuche fehlgeschlagen');
        setSuggestions([]);
      }
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Handle input change with debounce
  const handleInputChange = (value: string) => {
    setQuery(value);
    setGridCode(null);
    setError(null);

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (value.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Debounce 400ms
    debounceTimerRef.current = setTimeout(() => {
      abortControllerRef.current = new AbortController();
      searchNominatim(value, abortControllerRef.current.signal);
    }, 400);
  };

  // Handle suggestion selection
  const handleSelectSuggestion = async (suggestion: NominatimResult) => {
    setShowSuggestions(false);
    setSuggestions([]);
    setQuery(suggestion.display_name.split(',')[0]); // Show short name
    setError(null);
    setIsCreatingGrid(true);

    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);

    try {
      const { data, error: rpcError } = await supabase.rpc('ensure_grid_region', {
        lat,
        lon,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const result = data as GridResult;
      
      if (!result || !result.region_id) {
        throw new Error('No region returned');
      }

      setGridCode(result.grid_code);

      // Set the appropriate region based on target
      if (targetRegion === 'primary') {
        setSelectedRegionId(result.region_id);
      } else {
        setComparisonRegionId(result.region_id);
      }
    } catch (err) {
      setError(`Grid-Region konnte nicht erstellt werden: ${(err as Error).message}`);
    } finally {
      setIsCreatingGrid(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="shrink-0 border-b border-border p-4">
      <Label className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Search className="h-3 w-3" />
        Adresssuche
      </Label>

      {/* A/B Toggle for comparison mode */}
      {comparisonMode && (
        <div className="mb-2 flex gap-1">
          <Button
            variant={targetRegion === 'primary' ? 'default' : 'outline'}
            size="sm"
            className="h-6 flex-1 text-xs"
            onClick={() => setTargetRegion('primary')}
          >
            Region A
          </Button>
          <Button
            variant={targetRegion === 'comparison' ? 'default' : 'outline'}
            size="sm"
            className="h-6 flex-1 text-xs"
            onClick={() => setTargetRegion('comparison')}
          >
            Region B
          </Button>
        </div>
      )}

      <div className="relative">
        <Input
          type="text"
          placeholder="Adresse eingeben..."
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          className="h-8 bg-background pr-8 text-sm"
        />
        
        {/* Loading indicator */}
        {(isSearching || isCreatingGrid) && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-popover shadow-lg">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.place_id}
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleSelectSuggestion(suggestion)}
              >
                <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="line-clamp-2 text-xs">{suggestion.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Status messages */}
      {isCreatingGrid && (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Grid-Region wird erstellt…
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}

      {/* Grid code display */}
      {gridCode && !error && (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Grid3X3 className="h-3 w-3" />
          <span className="font-mono">{gridCode}</span>
        </p>
      )}
    </div>
  );
};

export default AddressSearch;
