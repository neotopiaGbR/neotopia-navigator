import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface IndicatorOption {
  code: string;
  name: string;
  unit: string;
  category: string | null;
}

export interface IndicatorsByCategory {
  category: string;
  indicators: IndicatorOption[];
}

// Category display order
const CATEGORY_ORDER = [
  'Demografie',
  'Geografie',
  'Landnutzung',
  'Klima',
  'Umwelt',
  'Sonstiges',
];

interface UseAllIndicatorsResult {
  indicators: IndicatorOption[];
  indicatorsByCategory: IndicatorsByCategory[];
  isLoading: boolean;
  error: string | null;
}

export function useAllIndicators(): UseAllIndicatorsResult {
  const [indicators, setIndicators] = useState<IndicatorOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: queryError } = await supabase
          .from('indicators')
          .select('code, name, unit, category')
          .order('name');

        if (import.meta.env.DEV) {
          console.log('[useAllIndicators] Query response:', { data, error: queryError });
        }

        if (queryError) {
          console.error('[useAllIndicators] Query error:', queryError);
          throw queryError;
        }

        if (cancelled) return;

        setIndicators(data ?? []);
      } catch (err) {
        console.error('[useAllIndicators] Error:', err);
        if (!cancelled) {
          setError('Failed to load indicators');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Group indicators by category with proper ordering
  const indicatorsByCategory = useMemo(() => {
    const categoryMap = new Map<string, IndicatorOption[]>();

    for (const ind of indicators) {
      const cat = ind.category || 'Sonstiges';
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, []);
      }
      categoryMap.get(cat)!.push(ind);
    }

    // Sort categories by predefined order
    const sorted: IndicatorsByCategory[] = [];
    
    for (const cat of CATEGORY_ORDER) {
      if (categoryMap.has(cat)) {
        sorted.push({
          category: cat,
          indicators: categoryMap.get(cat)!,
        });
        categoryMap.delete(cat);
      }
    }

    // Add any remaining categories not in the predefined order
    for (const [cat, inds] of categoryMap) {
      sorted.push({ category: cat, indicators: inds });
    }

    return sorted;
  }, [indicators]);

  return { indicators, indicatorsByCategory, isLoading, error };
}
