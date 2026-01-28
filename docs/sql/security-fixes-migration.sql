-- Security Fixes Migration (Complete & Corrected)
-- Addresses Supabase Security Advisor errors and warnings
-- Run in Cloud View > Run SQL

-- 0. CREATE has_role HELPER FUNCTION
CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND role = p_role
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO service_role;

-- 1. ENABLE RLS ON TABLES
ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read data_sources" ON public.data_sources;
CREATE POLICY "Authenticated users can read data_sources" ON public.data_sources FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can manage data_sources" ON public.data_sources;
CREATE POLICY "Admins can manage data_sources" ON public.data_sources FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.data_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read data_products" ON public.data_products;
CREATE POLICY "Authenticated users can read data_products" ON public.data_products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can manage data_products" ON public.data_products;
CREATE POLICY "Admins can manage data_products" ON public.data_products FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read import_jobs" ON public.import_jobs;
CREATE POLICY "Admins can read import_jobs" ON public.import_jobs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins can manage import_jobs" ON public.import_jobs;
CREATE POLICY "Admins can manage import_jobs" ON public.import_jobs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.grid_regions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read grid_regions" ON public.grid_regions;
CREATE POLICY "Authenticated users can read grid_regions" ON public.grid_regions FOR SELECT TO authenticated USING (true);

-- 2. FIX FUNCTION SEARCH PATH
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role) VALUES (NEW.id, NEW.email, 'kommune');
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.get_region_indicators(uuid, integer);
CREATE FUNCTION public.get_region_indicators(p_region_id uuid, p_year integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('indicator_id', iv.indicator_id, 'indicator_code', i.code, 'indicator_name', i.name, 'value', iv.value, 'value_text', iv.value_text, 'unit', i.unit, 'year', iv.year, 'scenario', iv.scenario, 'period_start', iv.period_start, 'period_end', iv.period_end, 'computed_at', iv.computed_at))
  INTO result
  FROM public.indicator_values iv
  JOIN public.indicators i ON i.id = iv.indicator_id
  WHERE iv.region_id = p_region_id AND (p_year IS NULL OR iv.year = p_year) AND (iv.expires_at IS NULL OR iv.expires_at > now()) AND iv.stale = false;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

DROP FUNCTION IF EXISTS public.ensure_grid_region(double precision, double precision);
CREATE FUNCTION public.ensure_grid_region(p_lat double precision, p_lon double precision)
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
  SELECT ST_X(pt), ST_Y(pt) INTO v_x_3035, v_y_3035 FROM ST_Transform(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), 3035) AS pt;
  v_x_min := floor(v_x_3035 / 1000) * 1000;
  v_y_min := floor(v_y_3035 / 1000) * 1000;
  v_grid_code := 'E' || (v_x_min / 1000)::int || 'N' || (v_y_min / 1000)::int;
  SELECT id INTO v_region_id FROM public.regions WHERE grid_code = v_grid_code AND region_type = 'grid_1km';
  IF v_region_id IS NOT NULL THEN RETURN v_region_id; END IF;
  v_geom := ST_Transform(ST_SetSRID(ST_MakePolygon(ST_MakeLine(ARRAY[ST_MakePoint(v_x_min, v_y_min), ST_MakePoint(v_x_min + 1000, v_y_min), ST_MakePoint(v_x_min + 1000, v_y_min + 1000), ST_MakePoint(v_x_min, v_y_min + 1000), ST_MakePoint(v_x_min, v_y_min)])), 3035), 4326);
  INSERT INTO public.regions (region_type, grid_code, name, geom) VALUES ('grid_1km', v_grid_code, v_grid_code, ST_Multi(v_geom)) RETURNING id INTO v_region_id;
  RETURN v_region_id;
END;
$$;

-- 3. FIX OVERLY PERMISSIVE RLS POLICIES
DROP POLICY IF EXISTS "Anyone can read regions" ON public.regions;
DROP POLICY IF EXISTS "Service role can insert regions" ON public.regions;
DROP POLICY IF EXISTS "Service role can update regions" ON public.regions;
DROP POLICY IF EXISTS "Authenticated users can read regions" ON public.regions;
CREATE POLICY "Authenticated users can read regions" ON public.regions FOR SELECT TO authenticated USING (true);

-- 4. GRANT FUNCTION EXECUTION
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_region_indicators(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_region_indicators(uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.ensure_grid_region(double precision, double precision) TO authenticated;
