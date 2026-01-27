-- Map Layers Registry Migration
-- Creates table for storing map layer configurations (basemaps, WMS, XYZ, GeoTIFF)

-- Create the map_layers_registry table
CREATE TABLE IF NOT EXISTS public.map_layers_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('basemap', 'wms', 'xyz', 'geotiff')),
  url TEXT NOT NULL,
  layer_name TEXT,
  attribution TEXT NOT NULL,
  license TEXT,
  coverage TEXT,
  notes TEXT,
  return_period INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.map_layers_registry ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can read map layers"
  ON public.map_layers_registry
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow admins to manage (if needed later)
-- CREATE POLICY "Admins can manage map layers"
--   ON public.map_layers_registry
--   FOR ALL
--   TO authenticated
--   USING (is_admin())
--   WITH CHECK (is_admin());

-- Create index on key for fast lookups
CREATE INDEX IF NOT EXISTS idx_map_layers_key ON public.map_layers_registry(key);
CREATE INDEX IF NOT EXISTS idx_map_layers_type ON public.map_layers_registry(type);

-- Seed initial layer configurations
INSERT INTO public.map_layers_registry (key, name, type, url, layer_name, attribution, license, coverage, notes, return_period)
VALUES
  -- Flood Risk WMS Layers (Copernicus EFAS)
  (
    'flood_risk_europe_wms_rp10',
    'Hochwasserrisiko (10 Jahre)',
    'wms',
    'https://maps.copernicus.eu/geoserver/ows',
    'CEMS:floodhazard_rp10',
    'Copernicus Emergency Management Service',
    'Copernicus Data Policy',
    'Europe',
    'Return period 10 years flood hazard map',
    10
  ),
  (
    'flood_risk_europe_wms_rp20',
    'Hochwasserrisiko (20 Jahre)',
    'wms',
    'https://maps.copernicus.eu/geoserver/ows',
    'CEMS:floodhazard_rp20',
    'Copernicus Emergency Management Service',
    'Copernicus Data Policy',
    'Europe',
    'Return period 20 years flood hazard map',
    20
  ),
  (
    'flood_risk_europe_wms_rp50',
    'Hochwasserrisiko (50 Jahre)',
    'wms',
    'https://maps.copernicus.eu/geoserver/ows',
    'CEMS:floodhazard_rp50',
    'Copernicus Emergency Management Service',
    'Copernicus Data Policy',
    'Europe',
    'Return period 50 years flood hazard map',
    50
  ),
  (
    'flood_risk_europe_wms_rp100',
    'Hochwasserrisiko (100 Jahre)',
    'wms',
    'https://maps.copernicus.eu/geoserver/ows',
    'CEMS:floodhazard_rp100',
    'Copernicus Emergency Management Service',
    'Copernicus Data Policy',
    'Europe',
    'Return period 100 years flood hazard map',
    100
  ),
  -- JRC Global Flood Hazard (fallback GeoTIFF)
  (
    'flood_hazard_jrc_rp100',
    'JRC Hochwassergefährdung (100 Jahre)',
    'geotiff',
    'https://data.jrc.ec.europa.eu/collection/id-0054',
    NULL,
    'JRC / European Commission',
    'JRC Open Data Licence',
    'Global',
    'JRC Global River Flood Hazard Maps at 1km resolution. Return period 100 years.',
    100
  ),
  -- Global Surface Water (XYZ tiles)
  (
    'gsw_occurrence',
    'Oberflächenwasser Vorkommen',
    'xyz',
    'https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png',
    NULL,
    'JRC/Google Global Surface Water',
    'Creative Commons CC-BY 4.0',
    'Global',
    'Water occurrence frequency 1984-2021',
    NULL
  )
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  url = EXCLUDED.url,
  layer_name = EXCLUDED.layer_name,
  attribution = EXCLUDED.attribution,
  license = EXCLUDED.license,
  coverage = EXCLUDED.coverage,
  notes = EXCLUDED.notes,
  return_period = EXCLUDED.return_period,
  updated_at = now();

-- Create raster_sources cache table for ECOSTRESS tile caching
CREATE TABLE IF NOT EXISTS public.raster_sources_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tile_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('ecostress_lst', 'flood_hazard')),
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  cog_url TEXT,
  cloud_mask_url TEXT,
  acquisition_datetime TIMESTAMPTZ,
  date_window_start DATE,
  date_window_end DATE,
  granule_id TEXT,
  qc_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '30 days',
  UNIQUE(tile_id, source_type, date_window_start, date_window_end)
);

-- Enable RLS
ALTER TABLE public.raster_sources_cache ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can read raster cache"
  ON public.raster_sources_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_raster_sources_tile ON public.raster_sources_cache(tile_id, source_type);
CREATE INDEX IF NOT EXISTS idx_raster_sources_expires ON public.raster_sources_cache(expires_at);

-- Grant permissions
GRANT SELECT ON public.map_layers_registry TO authenticated;
GRANT SELECT ON public.raster_sources_cache TO authenticated;
