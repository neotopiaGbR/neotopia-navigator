import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'selected_indicator_codes';

const DEFAULT_CODES = [
  'population_total',
  'population_density',
  'median_age',
  'share_over_65',
  'sealed_surface_share',
  'heat_days_30c',
];

export function useIndicatorSelection() {
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(() => {
    // Initialize from localStorage or defaults
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return new Set(parsed);
        }
      }
    } catch (e) {
      console.error('[useIndicatorSelection] Failed to parse localStorage:', e);
    }
    return new Set(DEFAULT_CODES);
  });

  // Persist to localStorage whenever selection changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedCodes)));
    } catch (e) {
      console.error('[useIndicatorSelection] Failed to save to localStorage:', e);
    }
  }, [selectedCodes]);

  const toggleCode = useCallback((code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((codes: string[]) => {
    setSelectedCodes(new Set(codes));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedCodes(new Set());
  }, []);

  const isSelected = useCallback((code: string) => selectedCodes.has(code), [selectedCodes]);

  return {
    selectedCodes,
    selectedCodesArray: Array.from(selectedCodes),
    toggleCode,
    selectAll,
    deselectAll,
    isSelected,
  };
}
