// Import Job Status - extended
export type ImportJobStatus = 'pending' | 'queued' | 'running' | 'loaded' | 'failed' | 'partial';
export type ImportScope = 'Berlin_BBOX' | 'EU_full';
export type LogLevel = 'info' | 'warn' | 'error';

// Data Source with key for registry
export interface DataSource {
  id: string;
  key: string;
  name: string;
  description: string | null;
  homepage: string | null;
  license_name: string;
  license_url: string | null;
  attribution_text: string;
  created_at: string;
  updated_at: string;
}

// Extended Data Product
export interface DataProduct {
  id: string;
  source_id: string;
  key: string;
  name: string;
  description: string | null;
  spatial_coverage: string | null;
  spatial_resolution: string | null;
  temporal_coverage: string | null;
  update_frequency: string | null;
  access_url: string | null;
  format: string | null;
  expected_processing: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  source?: DataSource;
  latest_import?: ImportJob | null;
}

// Extended Import Job
export interface ImportJob {
  id: string;
  product_id: string;
  scope: string;
  status: ImportJobStatus;
  priority: number;
  params: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
  raw_artifacts: string[] | null;
  rows_loaded: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  product?: DataProduct;
}

// Import Job Log
export interface ImportJobLog {
  id: string;
  job_id: string;
  ts: string;
  level: LogLevel;
  message: string;
  meta: Record<string, unknown> | null;
}

// Import Overview returned by RPC
export interface ImportOverview {
  total_products: number;
  by_status: Record<ImportJobStatus, number>;
  readiness_percent: number;
  latest_runs: Array<{
    product_key: string;
    product_name: string;
    status: ImportJobStatus;
    finished_at: string | null;
  }>;
}

// Attribution view
export interface AttributionEntry {
  source_key: string;
  source_name: string;
  attribution_text: string;
  license_name: string;
  license_url: string | null;
  homepage: string | null;
  products: Array<{
    key: string;
    name: string;
    spatial_resolution: string | null;
    temporal_coverage: string | null;
  }>;
}

// Create inputs
export interface CreateDataSourceInput {
  key: string;
  name: string;
  description?: string;
  homepage?: string;
  license_name: string;
  license_url?: string;
  attribution_text: string;
}

export interface CreateDataProductInput {
  source_id: string;
  key: string;
  name: string;
  description?: string;
  spatial_coverage?: string;
  spatial_resolution?: string;
  temporal_coverage?: string;
  update_frequency?: string;
  access_url?: string;
  format?: string;
  expected_processing?: string;
}

export interface EnqueueImportJobInput {
  product_key: string;
  params?: Record<string, unknown>;
}
