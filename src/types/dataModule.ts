export type ImportJobStatus = 'pending' | 'running' | 'loaded' | 'failed';
export type ImportScope = 'Berlin_BBOX' | 'EU_full';

export interface DataSource {
  id: string;
  name: string;
  description: string | null;
  license_name: string;
  license_url: string | null;
  attribution_text: string;
  website_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DataProduct {
  id: string;
  source_id: string;
  name: string;
  description: string | null;
  resolution: string | null;
  temporal_coverage: string | null;
  update_frequency: string | null;
  access_url: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  source?: DataSource;
  latest_import?: ImportJob | null;
}

export interface ImportJob {
  id: string;
  product_id: string;
  status: ImportJobStatus;
  scope: ImportScope;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  product?: DataProduct;
}

export interface CreateDataSourceInput {
  name: string;
  description?: string;
  license_name: string;
  license_url?: string;
  attribution_text: string;
  website_url?: string;
}

export interface CreateDataProductInput {
  source_id: string;
  name: string;
  description?: string;
  resolution?: string;
  temporal_coverage?: string;
  update_frequency?: string;
  access_url?: string;
}

export interface CreateImportJobInput {
  product_id: string;
  scope: ImportScope;
}
