import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { DataProduct, CreateDataProductInput, ImportJob } from '@/types/dataModule';

export function useDataProducts() {
  return useQuery({
    queryKey: ['data-products'],
    queryFn: async (): Promise<DataProduct[]> => {
      // Get products with source info
      const { data: products, error: productsError } = await supabase
        .from('data_products')
        .select(`
          *,
          source:data_sources(*)
        `)
        .order('name');

      if (productsError) throw productsError;
      if (!products) return [];

      // Get latest import job for each product
      const productIds = products.map(p => p.id);
      const { data: jobs, error: jobsError } = await supabase
        .from('import_jobs')
        .select('*')
        .in('product_id', productIds)
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;

      // Map latest job to each product
      const latestJobByProduct = new Map<string, ImportJob>();
      for (const job of jobs || []) {
        if (!latestJobByProduct.has(job.product_id)) {
          latestJobByProduct.set(job.product_id, job as ImportJob);
        }
      }

      return products.map(p => ({
        ...p,
        latest_import: latestJobByProduct.get(p.id) || null,
      })) as DataProduct[];
    },
  });
}

export function useDataProductsBySource(sourceId: string | undefined) {
  return useQuery({
    queryKey: ['data-products', 'by-source', sourceId],
    queryFn: async (): Promise<DataProduct[]> => {
      if (!sourceId) return [];

      const { data: products, error: productsError } = await supabase
        .from('data_products')
        .select('*')
        .eq('source_id', sourceId)
        .order('name');

      if (productsError) throw productsError;
      if (!products) return [];

      // Get latest import job for each product
      const productIds = products.map(p => p.id);
      if (productIds.length === 0) return products as DataProduct[];

      const { data: jobs, error: jobsError } = await supabase
        .from('import_jobs')
        .select('*')
        .in('product_id', productIds)
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;

      // Map latest job to each product
      const latestJobByProduct = new Map<string, ImportJob>();
      for (const job of jobs || []) {
        if (!latestJobByProduct.has(job.product_id)) {
          latestJobByProduct.set(job.product_id, job as ImportJob);
        }
      }

      return products.map(p => ({
        ...p,
        latest_import: latestJobByProduct.get(p.id) || null,
      })) as DataProduct[];
    },
    enabled: !!sourceId,
  });
}

export function useCreateDataProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateDataProductInput): Promise<DataProduct> => {
      const { data, error } = await supabase
        .from('data_products')
        .insert(input)
        .select()
        .single();

      if (error) throw error;
      return data as DataProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}

export function useUpdateDataProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<DataProduct> & { id: string }): Promise<DataProduct> => {
      const { data, error } = await supabase
        .from('data_products')
        .update(input)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as DataProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}

export function useDeleteDataProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('data_products')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}
