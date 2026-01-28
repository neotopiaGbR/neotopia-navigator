-- DWD Temperature Tiles Infrastructure
-- Run this migration to create storage bucket and metadata table for DWD HYRAS-DE temperature grids

-- Create storage bucket for DWD temperature tiles
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dwd-temperature-tiles',
  'dwd-temperature-tiles',
  true,
  5242880, -- 5MB max per tile
  ARRAY['image/png']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Create metadata table for DWD grid datasets
CREATE TABLE IF NOT EXISTS public.dwd_grid_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_key TEXT NOT NULL, -- e.g., 'air_temp_mean_jja_2024'
  variable TEXT NOT NULL, -- 'air_temperature_mean', 'air_temperature_max', 'air_temperature_min'
  year INTEGER NOT NULL,
  season TEXT NOT NULL DEFAULT 'JJA', -- June-July-August
  
  -- Grid metadata (EPSG:3035 / LAEA Europe)
  ncols INTEGER NOT NULL,
  nrows INTEGER NOT NULL,
  xllcorner DOUBLE PRECISION NOT NULL, -- EPSG:3035 x coordinate of lower-left corner
  yllcorner DOUBLE PRECISION NOT NULL, -- EPSG:3035 y coordinate of lower-left corner
  cellsize DOUBLE PRECISION NOT NULL DEFAULT 1000, -- 1km cells
  nodata_value DOUBLE PRECISION NOT NULL DEFAULT -999,
  
  -- Statistics for color normalization
  value_min DOUBLE PRECISION,
  value_max DOUBLE PRECISION,
  value_p5 DOUBLE PRECISION,
  value_p95 DOUBLE PRECISION,
  value_mean DOUBLE PRECISION,
  
  -- Coverage in WGS84 for map bounds
  bbox_wgs84 JSONB, -- [minLon, minLat, maxLon, maxLat]
  
  -- Tile storage info
  tile_path_pattern TEXT, -- e.g., 'jja_2024_mean/{z}/{x}/{y}.png'
  tile_zoom_levels INTEGER[] DEFAULT ARRAY[5,6,7,8,9,10],
  
  -- Source info
  source_url TEXT NOT NULL,
  attribution TEXT NOT NULL DEFAULT 'Source: Deutscher Wetterdienst (DWD), CC BY 4.0',
  license TEXT NOT NULL DEFAULT 'CC BY 4.0',
  
  -- Timestamps
  source_date DATE,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '180 days',
  
  UNIQUE(variable, year, season)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_dwd_grid_datasets_lookup 
  ON public.dwd_grid_datasets(variable, year, season);

-- RLS policies
ALTER TABLE public.dwd_grid_datasets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to dwd_grid_datasets" ON public.dwd_grid_datasets;
CREATE POLICY "Allow public read access to dwd_grid_datasets"
  ON public.dwd_grid_datasets
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- Storage policies - allow anyone to read tiles
DROP POLICY IF EXISTS "Allow public read access to dwd tiles" ON storage.objects;
CREATE POLICY "Allow public read access to dwd tiles"
  ON storage.objects
  FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'dwd-temperature-tiles');

-- Allow service role / authenticated users to write tiles
DROP POLICY IF EXISTS "Allow service role to write dwd tiles" ON storage.objects;
CREATE POLICY "Allow service role to write dwd tiles"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'dwd-temperature-tiles');

-- Comment on table
COMMENT ON TABLE public.dwd_grid_datasets IS 'Metadata registry for DWD HYRAS-DE temperature grid datasets stored as PNG tiles in Supabase Storage';
