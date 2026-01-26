import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { DataSource, CreateDataSourceInput } from '@/types/dataModule';

export function useDataSources() {
  return useQuery({
    queryKey: ['data-sources'],
    queryFn: async (): Promise<DataSource[]> => {
      const { data, error } = await supabase
        .from('data_sources')
        .select('*')
        .order('name');

      if (error) throw error;
      return data || [];
    },
  });
}

export function useDataSource(id: string | undefined) {
  return useQuery({
    queryKey: ['data-sources', id],
    queryFn: async (): Promise<DataSource | null> => {
      if (!id) return null;
      
      const { data, error } = await supabase
        .from('data_sources')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateDataSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateDataSourceInput): Promise<DataSource> => {
      const { data, error } = await supabase
        .from('data_sources')
        .insert(input)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data-sources'] });
    },
  });
}

export function useUpdateDataSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<DataSource> & { id: string }): Promise<DataSource> => {
      const { data, error } = await supabase
        .from('data_sources')
        .update(input)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['data-sources'] });
      queryClient.invalidateQueries({ queryKey: ['data-sources', variables.id] });
    },
  });
}

export function useDeleteDataSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('data_sources')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data-sources'] });
    },
  });
}
