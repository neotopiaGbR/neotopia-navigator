import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface IndicatorOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  domain: string;
  topic: string | null;
  value_type: string;
  temporal_type: string;
  direction: string;
  format: string;
  precision: number;
  requires_scenario: boolean;
  requires_period: boolean;
  sort_order: number;
  category: string | null;
}

export interface IndicatorsByDomain {
  domain: string;
  label: string;
  indicators: IndicatorOption[];
}

// Alias for backward compatibility
export type IndicatorsByCategory = IndicatorsByDomain;

// Domain display order and labels
const DOMAIN_ORDER = [
  'Klima',
  'Wasser',
  'Landnutzung',
  'Demografie',
  'Umwelt',
  'Mobilität',
  'Infrastruktur',
  'Risiko',
  'Kontext',
];

const DOMAIN_LABELS: Record<string, string> = {
  'Klima': 'Klima & Extremwetter',
  'Wasser': 'Wasser & Schwammstadt',
  'Landnutzung': 'Landnutzung & Grün',
  'Demografie': 'Bevölkerung & Soziales',
  'Umwelt': 'Luftqualität & Umwelt',
  'Mobilität': 'Mobilität & Erreichbarkeit',
  'Infrastruktur': 'Infrastruktur & Versorgung',
  'Risiko': 'Klimarisiken',
  'Kontext': 'Kontext & Verwaltung',
};

interface UseAllIndicatorsResult {
  indicators: IndicatorOption[];
  indicatorsByDomain: IndicatorsByDomain[];
  indicatorsByCategory: IndicatorsByDomain[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAllIndicators(
  domainFilter?: string,
  searchQuery?: string
): UseAllIndicatorsResult {
  const [indicators, setIndicators] = useState<IndicatorOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Use the RPC function for filtering
        const { data, error: queryError } = await supabase.rpc('list_indicators', {
          p_domain: domainFilter || null,
          p_query: searchQuery || null,
        });

        if (import.meta.env.DEV) {
          console.log('[useAllIndicators] RPC response:', { 
            count: data?.length, 
            domainFilter, 
            searchQuery,
            error: queryError 
          });
        }

        if (queryError) {
          console.error('[useAllIndicators] RPC error:', queryError);
          // Fallback to direct query if RPC doesn't exist
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('indicators')
            .select('*')
            .order('name');
          
          if (fallbackError) throw fallbackError;
          if (cancelled) return;
          
          // Map fallback data to ensure all fields exist
          const mapped = (fallbackData || []).map((ind: Record<string, unknown>) => ({
            id: ind.id as string || '',
            code: ind.code as string || '',
            name: ind.name as string || '',
            description: ind.description as string | null,
            unit: ind.unit as string || '',
            domain: ind.domain as string || ind.category as string || 'Kontext',
            topic: ind.topic as string | null,
            value_type: ind.value_type as string || 'number',
            temporal_type: ind.temporal_type as string || 'annual',
            direction: ind.direction as string || 'neutral',
            format: ind.format as string || 'number',
            precision: ind.precision as number || 1,
            requires_scenario: ind.requires_scenario as boolean || false,
            requires_period: ind.requires_period as boolean || false,
            sort_order: ind.sort_order as number || 1000,
            category: ind.category as string | null,
          }));
          setIndicators(mapped);
          return;
        }

        if (cancelled) return;
        
        // Map RPC data to ensure all fields exist
        const mapped = (data || []).map((ind: Record<string, unknown>) => ({
          id: ind.id as string || '',
          code: ind.code as string || '',
          name: ind.name as string || '',
          description: ind.description as string | null,
          unit: ind.unit as string || '',
          domain: ind.domain as string || 'Kontext',
          topic: ind.topic as string | null,
          value_type: ind.value_type as string || 'number',
          temporal_type: ind.temporal_type as string || 'annual',
          direction: ind.direction as string || 'neutral',
          format: ind.format as string || 'number',
          precision: ind.precision as number || 1,
          requires_scenario: ind.requires_scenario as boolean || false,
          requires_period: ind.requires_period as boolean || false,
          sort_order: ind.sort_order as number || 1000,
          category: ind.category as string | null,
        }));
        setIndicators(mapped);
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
  }, [domainFilter, searchQuery, refreshKey]);

  // Group indicators by domain with proper ordering
  const indicatorsByDomain = useMemo(() => {
    const domainMap = new Map<string, IndicatorOption[]>();

    for (const ind of indicators) {
      const dom = ind.domain || 'Kontext';
      if (!domainMap.has(dom)) {
        domainMap.set(dom, []);
      }
      domainMap.get(dom)!.push(ind);
    }

    // Sort domains by predefined order
    const sorted: IndicatorsByDomain[] = [];
    
    for (const dom of DOMAIN_ORDER) {
      if (domainMap.has(dom)) {
        sorted.push({
          domain: dom,
          label: DOMAIN_LABELS[dom] || dom,
          indicators: domainMap.get(dom)!,
        });
        domainMap.delete(dom);
      }
    }

    // Add any remaining domains not in the predefined order
    for (const [dom, inds] of domainMap) {
      sorted.push({ 
        domain: dom, 
        label: DOMAIN_LABELS[dom] || dom,
        indicators: inds 
      });
    }

    return sorted;
  }, [indicators]);

  return { 
    indicators, 
    indicatorsByDomain, 
    indicatorsByCategory: indicatorsByDomain,
    isLoading, 
    error,
    refetch,
  };
}
