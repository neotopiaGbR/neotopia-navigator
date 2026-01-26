import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ImportJob, CreateImportJobInput, ImportJobStatus } from '@/types/dataModule';

export function useImportJobs(productId?: string) {
  return useQuery({
    queryKey: ['import-jobs', productId],
    queryFn: async (): Promise<ImportJob[]> => {
      let query = supabase
        .from('import_jobs')
        .select(`
          *,
          product:data_products(*)
        `)
        .order('created_at', { ascending: false });

      if (productId) {
        query = query.eq('product_id', productId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return (data || []) as ImportJob[];
    },
  });
}

export function useCreateImportJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateImportJobInput): Promise<ImportJob> => {
      const { data, error } = await supabase
        .from('import_jobs')
        .insert({
          product_id: input.product_id,
          scope: input.scope,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;
      return data as ImportJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}

export function useUpdateImportJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      id, 
      status, 
      error_message 
    }: { 
      id: string; 
      status: ImportJobStatus; 
      error_message?: string;
    }): Promise<ImportJob> => {
      const updates: Record<string, unknown> = { status };
      
      if (status === 'running') {
        updates.started_at = new Date().toISOString();
      } else if (status === 'loaded' || status === 'failed') {
        updates.completed_at = new Date().toISOString();
      }
      
      if (error_message) {
        updates.error_message = error_message;
      }

      const { data, error } = await supabase
        .from('import_jobs')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as ImportJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}

export function useDeleteImportJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('import_jobs')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}
