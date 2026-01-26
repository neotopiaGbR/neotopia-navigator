import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface IndicatorOption {
  code: string;
  name: string;
  unit: string;
}

interface UseAllIndicatorsResult {
  indicators: IndicatorOption[];
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
          .select('code, name, unit')
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

  return { indicators, isLoading, error };
}
