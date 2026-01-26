-- Climate Module Migration
-- Adds support for climate projection caching and centroid extraction

-- 1. Ensure indicator_values has all required columns
ALTER TABLE public.indicator_values 
  ADD COLUMN IF NOT EXISTS scenario text,
  ADD COLUMN IF NOT EXISTS period_start int,
  ADD COLUMN IF NOT EXISTS period_end int,
  ADD COLUMN IF NOT EXISTS year int,
  ADD COLUMN IF NOT EXISTS value_text text,
  ADD COLUMN IF NOT EXISTS source_dataset_key text,
  ADD COLUMN IF NOT EXISTS source_meta jsonb,
  ADD COLUMN IF NOT EXISTS stale boolean NOT NULL DEFAULT false;

-- 2. Create unique constraint for cache deduplication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'indicator_values_cache_unique'
  ) THEN
    ALTER TABLE public.indicator_values 
    ADD CONSTRAINT indicator_values_cache_unique 
    UNIQUE (indicator_id, region_id, year, scenario, period_start, period_end);
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 3. Add indexes for efficient cache lookups
CREATE INDEX IF NOT EXISTS idx_indicator_values_expires 
  ON public.indicator_values(expires_at) 
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_indicator_values_cache_lookup 
  ON public.indicator_values(region_id, scenario, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_indicator_values_dataset 
  ON public.indicator_values(source_dataset_key) 
  WHERE source_dataset_key IS NOT NULL;

-- 4. RPC to get region centroid for climate lookups
CREATE OR REPLACE FUNCTION public.get_region_centroid(p_region_id uuid)
RETURNS TABLE(lat double precision, lon double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    ST_Y(ST_Centroid(ST_Transform(geom, 4326))) as lat,
    ST_X(ST_Centroid(ST_Transform(geom, 4326))) as lon
  FROM public.regions
  WHERE id = p_region_id;
$$;

-- 5. Seed climate indicators into the registry
INSERT INTO public.indicators (code, name, description, unit, domain, topic, direction, format, precision)
VALUES
  -- Temperature
  ('mean_annual_temperature', 'Jahresmitteltemperatur', 'Durchschnittliche Jahrestemperatur (2m)', '°C', 'climate', 'temperature', 'lower_better', 'number', 1),
  ('summer_mean_temperature', 'Sommermittel (JJA)', 'Mitteltemperatur Juni–August', '°C', 'climate', 'temperature', 'lower_better', 'number', 1),
  ('heat_days_30c', 'Heiße Tage (≥30°C)', 'Tage mit Maximaltemperatur ≥ 30°C', 'Tage/Jahr', 'climate', 'temperature', 'lower_better', 'number', 0),
  ('tropical_nights_20c', 'Tropennächte (≥20°C)', 'Nächte mit Minimaltemperatur ≥ 20°C', 'Nächte/Jahr', 'climate', 'temperature', 'lower_better', 'number', 0),
  ('heatwave_duration_index', 'Hitzewellen-Index', 'Kumulierte Tage in Hitzewellen (≥3 Tage über 30°C)', 'Tage', 'climate', 'extremes', 'lower_better', 'number', 0),
  -- Extremes
  ('max_daily_temperature', 'Max. Tagestemperatur', 'Höchste gemessene Tagestemperatur im Jahr', '°C', 'climate', 'extremes', 'lower_better', 'number', 1),
  ('consecutive_dry_days', 'Trockentage max.', 'Max. Anzahl aufeinanderfolgender Tage ohne Niederschlag (< 1mm)', 'Tage', 'climate', 'extremes', 'lower_better', 'number', 0),
  ('heavy_precip_days_20mm', 'Starkniederschlagstage', 'Tage mit Niederschlag ≥ 20mm', 'Tage/Jahr', 'climate', 'extremes', 'lower_better', 'number', 0),
  -- Precipitation
  ('annual_precipitation_sum', 'Jahresniederschlag', 'Gesamtniederschlag pro Jahr', 'mm', 'climate', 'precipitation', 'neutral', 'number', 0),
  ('summer_precipitation_change', 'Sommerniederschlag (Δ)', 'Prozentuale Änderung des Sommerniederschlags vs. Baseline', '%', 'climate', 'precipitation', 'neutral', 'percent', 0),
  ('winter_precipitation_change', 'Winterniederschlag (Δ)', 'Prozentuale Änderung des Winterniederschlags vs. Baseline', '%', 'climate', 'precipitation', 'neutral', 'percent', 0),
  -- Urban Heat
  ('urban_heat_risk_index', 'Urbaner Hitzestress-Index', 'Kombinierter Index aus Hitzetagen, Tropennächten und Versiegelung', '0–100', 'climate', 'urban', 'lower_better', 'number', 0),
  ('heat_exposure_population_share', 'Hitzeexposition Bevölkerung', 'Anteil der Bevölkerung mit erhöhter Hitzebelastung', '%', 'climate', 'urban', 'lower_better', 'percent', 0)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  domain = EXCLUDED.domain,
  topic = EXCLUDED.topic,
  direction = EXCLUDED.direction,
  format = EXCLUDED.format,
  precision = EXCLUDED.precision;

-- 6. Seed climate datasets into the registry
INSERT INTO public.datasets (dataset_key, name, provider, license, attribution, access_type, base_url, coverage, notes)
VALUES
  ('copernicus_era5_land', 'ERA5-Land Hourly Data', 'Copernicus Climate Change Service (C3S)', 'CC BY 4.0', 
   'Copernicus Climate Change Service (C3S): ERA5-Land hourly data from 1950 to present', 
   'api', 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/reanalysis-era5-land', 
   'Global, 0.1° (~9km)', 'Historical reanalysis data for baseline climatology'),
  ('copernicus_eurocordex', 'EURO-CORDEX Regional Projections', 'Copernicus Climate Change Service (C3S)', 'CC BY 4.0', 
   'Copernicus Climate Change Service (C3S): EURO-CORDEX EUR-11 regional climate projections (bias-adjusted)', 
   'api', 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/projections-cordex-domains-single-levels', 
   'Europa, 0.11° (~12km)', 'CMIP6-based regional projections for SSP scenarios')
ON CONFLICT (dataset_key) DO UPDATE SET
  name = EXCLUDED.name,
  provider = EXCLUDED.provider,
  license = EXCLUDED.license,
  attribution = EXCLUDED.attribution,
  access_type = EXCLUDED.access_type,
  base_url = EXCLUDED.base_url,
  coverage = EXCLUDED.coverage,
  notes = EXCLUDED.notes;

-- 7. Map climate indicators to datasets
INSERT INTO public.indicator_datasets (indicator_code, dataset_key, connector_key, priority, params)
SELECT 
  i.code,
  CASE 
    WHEN i.code IN ('mean_annual_temperature', 'summer_mean_temperature', 'max_daily_temperature', 'annual_precipitation_sum') 
    THEN 'copernicus_era5_land'
    ELSE 'copernicus_eurocordex'
  END as dataset_key,
  'climate' as connector_key,
  1 as priority,
  jsonb_build_object(
    'baseline_period', jsonb_build_object('start', 1991, 'end', 2020),
    'projection_periods', jsonb_build_array(
      jsonb_build_object('start', 2031, 'end', 2060, 'label', 'near'),
      jsonb_build_object('start', 2071, 'end', 2100, 'label', 'far')
    )
  ) as params
FROM public.indicators i
WHERE i.domain = 'climate'
ON CONFLICT (indicator_code, dataset_key) DO NOTHING;

-- 8. RLS policies for indicator_values (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'indicator_values' AND policyname = 'Anyone can read indicator_values'
  ) THEN
    ALTER TABLE public.indicator_values ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Anyone can read indicator_values" 
      ON public.indicator_values FOR SELECT 
      USING (true);
  END IF;
END $$;

-- Service role can insert/update (for edge functions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'indicator_values' AND policyname = 'Service role can insert indicator_values'
  ) THEN
    CREATE POLICY "Service role can insert indicator_values" 
      ON public.indicator_values FOR INSERT 
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'indicator_values' AND policyname = 'Service role can update indicator_values'
  ) THEN
    CREATE POLICY "Service role can update indicator_values" 
      ON public.indicator_values FOR UPDATE 
      USING (true);
  END IF;
END $$;

-- Grant execute on RPCs
GRANT EXECUTE ON FUNCTION public.get_region_centroid(uuid) TO authenticated, anon, service_role;
