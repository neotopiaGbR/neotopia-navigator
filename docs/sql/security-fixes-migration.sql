-- Security Fixes Migration
-- Addresses Supabase Security Advisor errors and warnings
-- Run in Cloud View > Run SQL

-- =====================================================
-- 1. ENABLE RLS ON TABLES (Errors)
-- =====================================================

-- data_sources: authenticated read, admin write
ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read data_sources"
  ON public.data_sources FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage data_sources"
  ON public.data_sources FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- data_products: authenticated read, admin write
ALTER TABLE public.data_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read data_products"
  ON public.data_products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage data_products"
  ON public.data_products FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- import_jobs: admin only
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read import_jobs"
  ON public.import_jobs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage import_jobs"
  ON public.import_jobs FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- grid_regions: authenticated read, service role write
ALTER TABLE public.grid_regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read grid_regions"
  ON public.grid_regions FOR SELECT
  TO authenticated
  USING (true);

-- Note: spatial_ref_sys is a PostGIS system table - cannot modify RLS
-- You can revoke direct access if needed:
-- REVOKE ALL ON public.spatial_ref_sys FROM anon, authenticated;
-- GRANT SELECT ON public.spatial_ref_sys TO authenticated;

-- =====================================================
-- 2. FIX FUNCTION SEARCH PATH (Warnings)
-- =====================================================

-- Fix handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'kommune');
  RETURN NEW;
END;
$$;

-- Fix list_datasets (recreate with search_path)
CREATE OR REPLACE FUNCTION public.list_datasets()
RETURNS TABLE (
  dataset_key text,
  name text,
  provider text,
  license text,
  attribution text,
  access_type text,
  base_url text,
  coverage text,
  notes text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    dataset_key,
    name,
    provider,
    license,
    attribution,
    access_type,
    base_url,
    coverage,
    notes
  FROM public.datasets
  ORDER BY name;
$$;

-- Fix get_region_indicators (recreate with search_path)
CREATE OR REPLACE FUNCTION public.get_region_indicators(p_region_id uuid, p_year integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'indicator_id', iv.indicator_id,
      'indicator_code', i.code,
      'indicator_name', i.name,
      'value', iv.value,
      'value_text', iv.value_text,
      'unit', i.unit,
      'year', iv.year,
      'scenario', iv.scenario,
      'period_start', iv.period_start,
      'period_end', iv.period_end,
      'computed_at', iv.computed_at
    )
  )
  INTO result
  FROM public.indicator_values iv
  JOIN public.indicators i ON i.id = iv.indicator_id
  WHERE iv.region_id = p_region_id
    AND (p_year IS NULL OR iv.year = p_year)
    AND (iv.expires_at IS NULL OR iv.expires_at > now())
    AND iv.stale = false;
  
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Fix ensure_grid_region (recreate with search_path)
CREATE OR REPLACE FUNCTION public.ensure_grid_region(p_lat double precision, p_lon double precision)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_region_id uuid;
  v_grid_code text;
  v_geom geometry;
  v_x_3035 double precision;
  v_y_3035 double precision;
  v_x_min double precision;
  v_y_min double precision;
BEGIN
  -- Transform to EPSG:3035 for grid math
  SELECT ST_X(pt), ST_Y(pt)
  INTO v_x_3035, v_y_3035
  FROM ST_Transform(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), 3035) AS pt;
  
  -- Calculate 1km grid cell origin
  v_x_min := floor(v_x_3035 / 1000) * 1000;
  v_y_min := floor(v_y_3035 / 1000) * 1000;
  
  -- Generate grid code
  v_grid_code := 'E' || (v_x_min / 1000)::int || 'N' || (v_y_min / 1000)::int;
  
  -- Check if region exists
  SELECT id INTO v_region_id
  FROM public.regions
  WHERE grid_code = v_grid_code AND region_type = 'grid_1km';
  
  IF v_region_id IS NOT NULL THEN
    RETURN v_region_id;
  END IF;
  
  -- Create grid cell geometry in EPSG:3035, then transform to 4326
  v_geom := ST_Transform(
    ST_SetSRID(
      ST_MakePolygon(
        ST_MakeLine(ARRAY[
          ST_MakePoint(v_x_min, v_y_min),
          ST_MakePoint(v_x_min + 1000, v_y_min),
          ST_MakePoint(v_x_min + 1000, v_y_min + 1000),
          ST_MakePoint(v_x_min, v_y_min + 1000),
          ST_MakePoint(v_x_min, v_y_min)
        ])
      ),
      3035
    ),
    4326
  );
  
  -- Insert new region
  INSERT INTO public.regions (region_type, grid_code, name, geom)
  VALUES ('grid_1km', v_grid_code, v_grid_code, ST_Multi(v_geom))
  RETURNING id INTO v_region_id;
  
  RETURN v_region_id;
END;
$$;

-- =====================================================
-- 3. FIX OVERLY PERMISSIVE RLS POLICIES (Warnings)
-- =====================================================

-- Drop and recreate regions policies with proper restrictions
DROP POLICY IF EXISTS "Anyone can read regions" ON public.regions;
DROP POLICY IF EXISTS "Service role can insert regions" ON public.regions;
DROP POLICY IF EXISTS "Service role can update regions" ON public.regions;

-- Authenticated users can read all regions
CREATE POLICY "Authenticated users can read regions"
  ON public.regions FOR SELECT
  TO authenticated
  USING (true);

-- Only allow inserts via ensure_grid_region function (SECURITY DEFINER)
-- No direct insert policy for users

-- =====================================================
-- 4. GRANT FUNCTION EXECUTION
-- =====================================================

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.list_datasets() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_region_indicators(uuid, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.ensure_grid_region(double precision, double precision) TO authenticated;

-- =====================================================
-- NOTES:
-- - spatial_ref_sys RLS warning: This is a PostGIS system table.
--   Consider moving PostGIS to a separate schema if needed.
-- - Leaked Password Protection: Enable in Supabase Dashboard >
--   Authentication > Settings > Enable leaked password protection
-- - PostGIS in public schema: Consider moving to 'extensions' schema
--   for better security isolation.
-- =====================================================
