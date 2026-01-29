-- FIX: ensure_grid_region coordinate extraction
-- The previous version had incorrect ST_Transform usage that could cause coordinate extraction issues

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
  v_pt_3035 geometry;
  v_x_3035 double precision;
  v_y_3035 double precision;
  v_x_min double precision;
  v_y_min double precision;
BEGIN
  -- Transform input point to EPSG:3035 (ETRS89-LAEA)
  v_pt_3035 := ST_Transform(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), 3035);
  v_x_3035 := ST_X(v_pt_3035);
  v_y_3035 := ST_Y(v_pt_3035);
  
  -- Calculate 1km grid cell origin (southwest corner)
  v_x_min := floor(v_x_3035 / 1000.0) * 1000.0;
  v_y_min := floor(v_y_3035 / 1000.0) * 1000.0;
  
  -- Generate grid code (E = Easting in km, N = Northing in km)
  v_grid_code := 'E' || (v_x_min / 1000)::int || 'N' || (v_y_min / 1000)::int;
  
  -- Check if region already exists
  SELECT id INTO v_region_id 
  FROM public.regions 
  WHERE grid_code = v_grid_code AND region_type = 'grid_1km';
  
  IF v_region_id IS NOT NULL THEN 
    RETURN v_region_id; 
  END IF;
  
  -- Create 1km polygon in EPSG:3035, then transform to WGS84
  v_geom := ST_Transform(
    ST_SetSRID(
      ST_MakePolygon(
        ST_MakeLine(ARRAY[
          ST_MakePoint(v_x_min, v_y_min),              -- SW corner
          ST_MakePoint(v_x_min + 1000, v_y_min),       -- SE corner
          ST_MakePoint(v_x_min + 1000, v_y_min + 1000),-- NE corner
          ST_MakePoint(v_x_min, v_y_min + 1000),       -- NW corner
          ST_MakePoint(v_x_min, v_y_min)               -- Close ring (SW)
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

-- Grant execution rights
GRANT EXECUTE ON FUNCTION public.ensure_grid_region(double precision, double precision) TO authenticated;
