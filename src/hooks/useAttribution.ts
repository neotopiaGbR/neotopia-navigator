import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AttributionEntry, DataSource, DataProduct } from '@/types/dataModule';

export function useAttribution() {
  return useQuery({
    queryKey: ['attribution'],
    queryFn: async (): Promise<AttributionEntry[]> => {
      // Get all sources
      const { data: sources, error: sourcesError } = await supabase
        .from('data_sources')
        .select('*')
        .order('name');

      if (sourcesError) throw sourcesError;

      // Get all products
      const { data: products, error: productsError } = await supabase
        .from('data_products')
        .select('*')
        .order('name');

      if (productsError) throw productsError;

      // Group products by source
      const productsBySource = new Map<string, DataProduct[]>();
      for (const product of (products || []) as DataProduct[]) {
        const existing = productsBySource.get(product.source_id) || [];
        existing.push(product);
        productsBySource.set(product.source_id, existing);
      }

      // Build attribution entries
      const entries: AttributionEntry[] = ((sources || []) as DataSource[]).map(source => ({
        source_key: source.key,
        source_name: source.name,
        attribution_text: source.attribution_text,
        license_name: source.license_name,
        license_url: source.license_url,
        homepage: source.homepage,
        products: (productsBySource.get(source.id) || []).map(p => ({
          key: p.key,
          name: p.name,
          spatial_resolution: p.spatial_resolution,
          temporal_coverage: p.temporal_coverage,
        })),
      }));

      return entries.filter(e => e.products.length > 0);
    },
  });
}
