import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { 
  ImportJob, 
  ImportJobLog, 
  ImportOverview, 
  ImportJobStatus,
  EnqueueImportJobInput 
} from '@/types/dataModule';

// Get import overview via RPC
export function useImportOverview(scope: string = 'EU_full') {
  return useQuery({
    queryKey: ['import-overview', scope],
    queryFn: async (): Promise<ImportOverview> => {
      const { data, error } = await supabase.rpc('get_import_overview', { scope });
      
      if (error) {
        console.error('Import overview error:', error);
        // Return default structure if RPC doesn't exist yet
        return {
          total_products: 0,
          by_status: {} as Record<ImportJobStatus, number>,
          readiness_percent: 0,
          latest_runs: [],
        };
      }
      return data as ImportOverview;
    },
    refetchInterval: 10000, // Poll every 10s
  });
}

// Enqueue import job via RPC
export function useEnqueueImportJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: EnqueueImportJobInput): Promise<string> => {
      const { data, error } = await supabase.rpc('enqueue_import_job', {
        product_key: input.product_key,
        params: input.params || {},
      });

      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-overview'] });
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}

// Enqueue all products
export function useEnqueueAllImports() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<string[]> => {
      // Get all products
      const { data: products, error: productsError } = await supabase
        .from('data_products')
        .select('key');

      if (productsError) throw productsError;
      
      const jobIds: string[] = [];
      for (const product of products || []) {
        const { data, error } = await supabase.rpc('enqueue_import_job', {
          product_key: product.key,
          params: {},
        });
        if (!error && data) {
          jobIds.push(data as string);
        }
      }
      return jobIds;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-overview'] });
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}

// Update job status via RPC
export function useSetImportJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      job_id, 
      status, 
      error,
      rows_loaded,
    }: { 
      job_id: string; 
      status: ImportJobStatus;
      error?: string;
      rows_loaded?: number;
    }): Promise<void> => {
      const { error: rpcError } = await supabase.rpc('set_import_job_status', {
        job_id,
        status,
        error_msg: error || null,
        rows_loaded: rows_loaded || null,
      });

      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-overview'] });
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}

// Append log via RPC
export function useAppendImportLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      job_id, 
      level, 
      message,
      meta,
    }: { 
      job_id: string; 
      level: 'info' | 'warn' | 'error';
      message: string;
      meta?: Record<string, unknown>;
    }): Promise<void> => {
      const { error } = await supabase.rpc('append_import_log', {
        job_id,
        level,
        message,
        meta: meta || {},
      });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['import-job-logs', variables.job_id] });
    },
  });
}

// Get job logs
export function useImportJobLogs(jobId: string | undefined) {
  return useQuery({
    queryKey: ['import-job-logs', jobId],
    queryFn: async (): Promise<ImportJobLog[]> => {
      if (!jobId) return [];

      const { data, error } = await supabase
        .from('import_job_logs')
        .select('*')
        .eq('job_id', jobId)
        .order('ts', { ascending: true });

      if (error) throw error;
      return (data || []) as ImportJobLog[];
    },
    enabled: !!jobId,
    refetchInterval: 5000, // Poll logs
  });
}

// Get single job with product
export function useImportJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ['import-jobs', jobId],
    queryFn: async (): Promise<ImportJob | null> => {
      if (!jobId) return null;

      const { data, error } = await supabase
        .from('import_jobs')
        .select(`
          *,
          product:data_products(*, source:data_sources(*))
        `)
        .eq('id', jobId)
        .maybeSingle();

      if (error) throw error;
      return data as ImportJob | null;
    },
    enabled: !!jobId,
    refetchInterval: 5000,
  });
}

// Run import job (calls edge function)
export function useRunImportJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string): Promise<{ success: boolean; message: string }> => {
      // First set status to running
      await supabase.rpc('set_import_job_status', {
        job_id: jobId,
        status: 'running',
        error_msg: null,
        rows_loaded: null,
      });

      // Call edge function
      const { data, error } = await supabase.functions.invoke('import-runner', {
        body: { job_id: jobId },
      });

      if (error) {
        // Update status to failed
        await supabase.rpc('set_import_job_status', {
          job_id: jobId,
          status: 'failed',
          error_msg: error.message,
          rows_loaded: null,
        });
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-overview'] });
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['data-products'] });
    },
  });
}

// Get all import jobs (for admin)
export function useAllImportJobs() {
  return useQuery({
    queryKey: ['import-jobs', 'all'],
    queryFn: async (): Promise<ImportJob[]> => {
      const { data, error } = await supabase
        .from('import_jobs')
        .select(`
          *,
          product:data_products(*, source:data_sources(*))
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return (data || []) as ImportJob[];
    },
    refetchInterval: 10000,
  });
}

// Check data readiness for a region
export function useRegionDataReadiness(regionId: string | undefined) {
  return useQuery({
    queryKey: ['region-readiness', regionId],
    queryFn: async (): Promise<{ hasData: boolean; indicatorCount: number }> => {
      if (!regionId) return { hasData: false, indicatorCount: 0 };

      const { count, error } = await supabase
        .from('indicator_values')
        .select('*', { count: 'exact', head: true })
        .eq('region_id', regionId);

      if (error) {
        console.error('Readiness check error:', error);
        return { hasData: false, indicatorCount: 0 };
      }

      return { 
        hasData: (count || 0) > 0, 
        indicatorCount: count || 0 
      };
    },
    enabled: !!regionId,
  });
}
