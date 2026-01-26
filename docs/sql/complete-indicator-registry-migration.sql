-- ============================================================
-- NEOTOPIA NAVIGATOR: Complete Indicator Registry Migration
-- Run this in Supabase SQL Editor (single transaction)
-- ============================================================

-- ============================================================
-- PART 1: CORE SCHEMA - INDICATORS TABLE
-- ============================================================

-- Drop and recreate indicators table with full schema
DROP TABLE IF EXISTS public.indicator_datasets CASCADE;
DROP TABLE IF EXISTS public.indicator_values CASCADE;

-- Recreate indicators with complete schema
CREATE TABLE IF NOT EXISTS public.indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  unit text NOT NULL DEFAULT '',
  domain text NOT NULL DEFAULT 'Sonstiges',
  topic text,
  category text, -- Keep for backward compatibility, maps to domain
  direction text DEFAULT 'neutral' CHECK (direction IN ('higher_is_better', 'higher_is_worse', 'neutral')),
  format text DEFAULT 'number' CHECK (format IN ('number', 'percent', 'index', 'category', 'text')),
  precision int DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- Add columns if they don't exist (for existing tables)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'domain') THEN
    ALTER TABLE public.indicators ADD COLUMN domain text NOT NULL DEFAULT 'Sonstiges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'topic') THEN
    ALTER TABLE public.indicators ADD COLUMN topic text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'direction') THEN
    ALTER TABLE public.indicators ADD COLUMN direction text DEFAULT 'neutral';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'format') THEN
    ALTER TABLE public.indicators ADD COLUMN format text DEFAULT 'number';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'precision') THEN
    ALTER TABLE public.indicators ADD COLUMN precision int DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'description') THEN
    ALTER TABLE public.indicators ADD COLUMN description text;
  END IF;
END $$;

-- ============================================================
-- PART 2: DATASETS REGISTRY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_key text UNIQUE NOT NULL,
  name text NOT NULL,
  provider text NOT NULL,
  coverage text DEFAULT 'DE',
  license text NOT NULL,
  attribution text NOT NULL,
  access_type text DEFAULT 'api' CHECK (access_type IN ('api', 'wms', 'wfs', 'download', 'derived')),
  base_url text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- PART 3: INDICATOR-DATASET MAPPING
-- ============================================================

CREATE TABLE IF NOT EXISTS public.indicator_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_code text NOT NULL REFERENCES public.indicators(code) ON DELETE CASCADE,
  dataset_key text NOT NULL REFERENCES public.datasets(dataset_key) ON DELETE CASCADE,
  connector_key text NOT NULL,
  priority int DEFAULT 100,
  params jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(indicator_code, dataset_key)
);

-- ============================================================
-- PART 4: INDICATOR VALUES (TTL CACHE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.indicator_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id uuid NOT NULL REFERENCES public.indicators(id) ON DELETE CASCADE,
  region_id uuid NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  value numeric,
  value_text text,
  year int,
  scenario text,
  period_start int,
  period_end int,
  computed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  stale boolean NOT NULL DEFAULT false,
  source_dataset_key text,
  source_meta jsonb,
  UNIQUE(indicator_id, region_id, year, scenario, period_start, period_end)
);

-- Add columns if missing
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicator_values' AND column_name = 'value_text') THEN
    ALTER TABLE public.indicator_values ADD COLUMN value_text text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicator_values' AND column_name = 'scenario') THEN
    ALTER TABLE public.indicator_values ADD COLUMN scenario text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicator_values' AND column_name = 'period_start') THEN
    ALTER TABLE public.indicator_values ADD COLUMN period_start int;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicator_values' AND column_name = 'period_end') THEN
    ALTER TABLE public.indicator_values ADD COLUMN period_end int;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicator_values' AND column_name = 'expires_at') THEN
    ALTER TABLE public.indicator_values ADD COLUMN expires_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicator_values' AND column_name = 'stale') THEN
    ALTER TABLE public.indicator_values ADD COLUMN stale boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicator_values' AND column_name = 'source_dataset_key') THEN
    ALTER TABLE public.indicator_values ADD COLUMN source_dataset_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicator_values' AND column_name = 'source_meta') THEN
    ALTER TABLE public.indicator_values ADD COLUMN source_meta jsonb;
  END IF;
END $$;

-- ============================================================
-- PART 5: DATASET VERSIONS (PROVENANCE)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_key text REFERENCES public.datasets(dataset_key) ON DELETE CASCADE,
  version text,
  fetched_at timestamptz DEFAULT now(),
  valid_from date,
  valid_to date,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- PART 6: INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_indicator_values_region_indicator ON public.indicator_values(region_id, indicator_id);
CREATE INDEX IF NOT EXISTS idx_indicator_values_expires ON public.indicator_values(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_indicator_values_year ON public.indicator_values(year) WHERE year IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_indicator_values_scenario ON public.indicator_values(scenario) WHERE scenario IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_indicators_domain ON public.indicators(domain);
CREATE INDEX IF NOT EXISTS idx_indicators_code ON public.indicators(code);
CREATE INDEX IF NOT EXISTS idx_indicator_datasets_code ON public.indicator_datasets(indicator_code);
CREATE INDEX IF NOT EXISTS idx_indicator_datasets_connector ON public.indicator_datasets(connector_key);

-- ============================================================
-- PART 7: RLS POLICIES
-- ============================================================

ALTER TABLE public.indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicator_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicator_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataset_versions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can read indicators" ON public.indicators;
DROP POLICY IF EXISTS "Anyone can read datasets" ON public.datasets;
DROP POLICY IF EXISTS "Anyone can read indicator_datasets" ON public.indicator_datasets;
DROP POLICY IF EXISTS "Anyone can read indicator_values" ON public.indicator_values;
DROP POLICY IF EXISTS "Service role can write indicator_values" ON public.indicator_values;
DROP POLICY IF EXISTS "Anyone can read dataset_versions" ON public.dataset_versions;

-- Create read policies (public access for app)
CREATE POLICY "Anyone can read indicators" ON public.indicators FOR SELECT USING (true);
CREATE POLICY "Anyone can read datasets" ON public.datasets FOR SELECT USING (true);
CREATE POLICY "Anyone can read indicator_datasets" ON public.indicator_datasets FOR SELECT USING (true);
CREATE POLICY "Anyone can read indicator_values" ON public.indicator_values FOR SELECT USING (true);
CREATE POLICY "Anyone can read dataset_versions" ON public.dataset_versions FOR SELECT USING (true);

-- Service role write for indicator_values (Edge Functions use service role)
CREATE POLICY "Service role can write indicator_values" ON public.indicator_values 
  FOR ALL 
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- PART 8: RPC FUNCTIONS
-- ============================================================

-- List all datasets for attribution
CREATE OR REPLACE FUNCTION public.list_datasets()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'dataset_key', dataset_key,
        'name', name,
        'provider', provider,
        'coverage', coverage,
        'license', license,
        'attribution', attribution,
        'access_type', access_type,
        'base_url', base_url
      )
      ORDER BY provider, name
    ),
    '[]'::jsonb
  )
  FROM public.datasets;
$$;

-- List all indicators grouped by domain
CREATE OR REPLACE FUNCTION public.list_indicators()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'code', code,
        'name', name,
        'description', description,
        'unit', unit,
        'domain', domain,
        'topic', topic,
        'category', COALESCE(category, domain),
        'direction', direction,
        'format', format,
        'precision', precision
      )
      ORDER BY domain, name
    ),
    '[]'::jsonb
  )
  FROM public.indicators;
$$;

-- Get indicator-dataset mappings for a connector
CREATE OR REPLACE FUNCTION public.get_indicator_connectors(p_indicator_codes text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'indicator_code', id.indicator_code,
        'dataset_key', id.dataset_key,
        'connector_key', id.connector_key,
        'priority', id.priority,
        'params', id.params,
        'dataset', jsonb_build_object(
          'name', d.name,
          'provider', d.provider,
          'attribution', d.attribution,
          'license', d.license
        )
      )
      ORDER BY id.indicator_code, id.priority DESC
    ),
    '[]'::jsonb
  )
  FROM public.indicator_datasets id
  JOIN public.datasets d ON d.dataset_key = id.dataset_key
  WHERE id.indicator_code = ANY(p_indicator_codes);
$$;

GRANT EXECUTE ON FUNCTION public.list_datasets() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_indicators() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_indicator_connectors(text[]) TO anon, authenticated;

-- ============================================================
-- PART 9: SEED DATASETS
-- ============================================================

INSERT INTO public.datasets (dataset_key, name, provider, coverage, license, attribution, access_type, base_url, notes) VALUES
-- Climate datasets
('copernicus_era5', 'ERA5-Land', 'Copernicus CDS', 'Global', 'CC-BY-4.0', '© Copernicus Climate Change Service (C3S)', 'api', 'https://cds.climate.copernicus.eu/', 'Historical climate reanalysis 1950-present'),
('copernicus_cmip6', 'CMIP6 Climate Projections', 'Copernicus CDS', 'Global', 'CC-BY-4.0', '© CMIP6, Copernicus Climate Change Service', 'api', 'https://cds.climate.copernicus.eu/', 'SSP scenarios 2015-2100'),
('euro_cordex', 'EURO-CORDEX', 'Copernicus CDS', 'Europe', 'CC-BY-4.0', '© EURO-CORDEX, Copernicus Climate Change Service', 'api', 'https://cds.climate.copernicus.eu/', 'Regional downscaled projections EUR-11'),

-- Land use / land cover
('copernicus_clc', 'CORINE Land Cover', 'Copernicus Land', 'EU', 'Open Access', '© European Union, Copernicus Land Monitoring Service', 'download', 'https://land.copernicus.eu/en/products/corine-land-cover', 'CLC 2018/2021'),
('copernicus_hrl_imp', 'High Resolution Layer Imperviousness', 'Copernicus Land', 'EU', 'Open Access', '© European Union, Copernicus Land Monitoring Service', 'download', 'https://land.copernicus.eu/en/products/high-resolution-layer-imperviousness', '10m resolution'),
('copernicus_hrl_tree', 'High Resolution Layer Tree Cover', 'Copernicus Land', 'EU', 'Open Access', '© European Union, Copernicus Land Monitoring Service', 'download', 'https://land.copernicus.eu/en/products/high-resolution-layer-tree-cover-density', 'Tree cover density'),

-- Population / demography
('eurostat_geostat', 'GEOSTAT Population Grid', 'Eurostat', 'EU', 'CC-BY-4.0', '© European Union, Eurostat GEOSTAT', 'download', 'https://ec.europa.eu/eurostat/web/gisco/geodata/population-distribution/geostat', '1km grid population 2021'),
('zensus_de', 'Zensus 2022', 'Statistisches Bundesamt', 'DE', 'dl-de/by-2-0', '© Statistisches Bundesamt, Zensus 2022', 'download', 'https://www.zensus2022.de/', 'German census 2022'),

-- Air quality
('eea_aq', 'Air Quality e-Reporting', 'European Environment Agency', 'EU', 'ODC-BY-1.0', '© European Environment Agency', 'api', 'https://discomap.eea.europa.eu/map/fme/AirQualityExport.htm', 'Station measurements'),
('uba_aq', 'Luftqualitätsdaten', 'Umweltbundesamt', 'DE', 'dl-de/by-2-0', '© Umweltbundesamt', 'api', 'https://www.umweltbundesamt.de/daten/luft', 'German air quality network'),

-- OSM
('osm', 'OpenStreetMap', 'OpenStreetMap Contributors', 'Global', 'ODbL-1.0', '© OpenStreetMap contributors', 'api', 'https://www.openstreetmap.org/', 'POIs, infrastructure, green spaces'),

-- Risk / hazards
('jrc_flood', 'JRC Flood Hazard Maps', 'Joint Research Centre', 'EU', 'CC-BY-4.0', '© European Commission, JRC', 'download', 'https://data.jrc.ec.europa.eu/', 'Return period flood extents'),
('dwd_warnings', 'DWD Warnungen', 'Deutscher Wetterdienst', 'DE', 'dl-de/by-2-0', '© Deutscher Wetterdienst', 'api', 'https://opendata.dwd.de/', 'Weather warnings and extremes'),

-- Derived / computed
('derived_neotopia', 'Neotopia Derived Indicators', 'Neotopia', 'DE', 'CC-BY-4.0', '© Neotopia Navigator', 'derived', NULL, 'Composite indices and derived metrics')
ON CONFLICT (dataset_key) DO UPDATE SET
  name = EXCLUDED.name,
  provider = EXCLUDED.provider,
  coverage = EXCLUDED.coverage,
  license = EXCLUDED.license,
  attribution = EXCLUDED.attribution,
  access_type = EXCLUDED.access_type,
  base_url = EXCLUDED.base_url,
  notes = EXCLUDED.notes;

-- ============================================================
-- PART 10: SEED INDICATORS (COMPLETE REGISTRY)
-- ============================================================

-- Delete existing to avoid conflicts
DELETE FROM public.indicators;

INSERT INTO public.indicators (code, name, description, unit, domain, topic, category, direction, format, precision) VALUES
-- ===================== KLIMA & EXTREMWETTER =====================
('TEMP_MEAN', 'Jahresmitteltemperatur', 'Durchschnittliche Temperatur im Jahr', '°C', 'Klima', 'Temperatur', 'Klima', 'neutral', 'number', 1),
('TEMP_MAX', 'Maximale Jahrestemperatur', 'Höchste gemessene Temperatur im Jahr', '°C', 'Klima', 'Temperatur', 'Klima', 'higher_is_worse', 'number', 1),
('TEMP_MIN', 'Minimale Jahrestemperatur', 'Niedrigste gemessene Temperatur im Jahr', '°C', 'Klima', 'Temperatur', 'Klima', 'neutral', 'number', 1),
('TEMP_SUMMER_MEAN', 'Sommermitteltemperatur', 'Durchschnittliche Temperatur Juni-August', '°C', 'Klima', 'Temperatur', 'Klima', 'higher_is_worse', 'number', 1),
('HOT_DAYS_30C', 'Heiße Tage (>30°C)', 'Anzahl Tage mit Höchsttemperatur über 30°C', 'Tage/Jahr', 'Klima', 'Extremwetter', 'Klima', 'higher_is_worse', 'number', 0),
('TROPICAL_NIGHTS_20C', 'Tropennächte (>20°C)', 'Anzahl Nächte mit Tiefsttemperatur über 20°C', 'Nächte/Jahr', 'Klima', 'Extremwetter', 'Klima', 'higher_is_worse', 'number', 0),
('HEAT_INDEX', 'Hitzeindex', 'Kombinierter Hitze-Feuchte-Index', 'Index', 'Klima', 'Extremwetter', 'Klima', 'higher_is_worse', 'index', 1),
('WET_BULB_TEMP', 'Feuchtkugeltemperatur', 'Maximale Feuchtkugeltemperatur im Sommer', '°C', 'Klima', 'Extremwetter', 'Klima', 'higher_is_worse', 'number', 1),
('HEATWAVE_DAYS', 'Hitzewellentage', 'Tage in Hitzewellenperioden (≥3 Tage >30°C)', 'Tage/Jahr', 'Klima', 'Extremwetter', 'Klima', 'higher_is_worse', 'number', 0),
('COOLING_DEGREE_DAYS', 'Kühlgradtage', 'Summe der Kühlgradtage (Basis 18°C)', 'Kd', 'Klima', 'Energie', 'Klima', 'higher_is_worse', 'number', 0),
('HEATING_DEGREE_DAYS', 'Heizgradtage', 'Summe der Heizgradtage (Basis 15°C)', 'Hd', 'Klima', 'Energie', 'Klima', 'neutral', 'number', 0),
('PRECIP_TOTAL', 'Jahresniederschlag', 'Gesamtniederschlag im Jahr', 'mm/Jahr', 'Klima', 'Niederschlag', 'Klima', 'neutral', 'number', 0),
('PRECIP_SUMMER', 'Sommerniederschlag', 'Niederschlag Juni-August', 'mm', 'Klima', 'Niederschlag', 'Klima', 'higher_is_better', 'number', 0),
('PRECIP_WINTER', 'Winterniederschlag', 'Niederschlag Dezember-Februar', 'mm', 'Klima', 'Niederschlag', 'Klima', 'neutral', 'number', 0),
('PRECIP_INTENSE_DAYS', 'Starkniederschlagstage', 'Tage mit Niederschlag >20mm', 'Tage/Jahr', 'Klima', 'Extremwetter', 'Klima', 'higher_is_worse', 'number', 0),
('DROUGHT_INDEX', 'Dürreindex (SPI)', 'Standardisierter Niederschlagsindex', 'Index', 'Klima', 'Extremwetter', 'Klima', 'neutral', 'index', 2),
('WIND_MAX', 'Maximale Windgeschwindigkeit', 'Höchste gemessene Windgeschwindigkeit', 'm/s', 'Klima', 'Extremwetter', 'Klima', 'higher_is_worse', 'number', 1),
('STORM_DAYS', 'Sturmtage', 'Tage mit Windgeschwindigkeit >20 m/s', 'Tage/Jahr', 'Klima', 'Extremwetter', 'Klima', 'higher_is_worse', 'number', 0),
('SNOW_DAYS', 'Schneetage', 'Tage mit Schneebedeckung', 'Tage/Jahr', 'Klima', 'Niederschlag', 'Klima', 'neutral', 'number', 0),
('FROST_DAYS', 'Frosttage', 'Tage mit Tiefsttemperatur unter 0°C', 'Tage/Jahr', 'Klima', 'Temperatur', 'Klima', 'neutral', 'number', 0),
('CLIMATE_ANALOG_CITY', 'Klimaanalog-Stadt', 'Heutige Stadt mit ähnlichem Klima', '', 'Klima', 'Projektion', 'Klima', 'neutral', 'text', 0),
('WARMING_VS_BASELINE', 'Erwärmung vs. 1991-2020', 'Temperaturänderung gegenüber Referenzperiode', '°C', 'Klima', 'Projektion', 'Klima', 'higher_is_worse', 'number', 1),

-- ===================== WASSER & SCHWAMMSTADT =====================
('RUNOFF_RISK', 'Oberflächenabflussrisiko', 'Index für Oberflächenabfluss bei Starkregen', 'Index', 'Wasser', 'Schwammstadt', 'Umwelt', 'higher_is_worse', 'index', 0),
('FLOOD_PLAINS_SHARE', 'Überschwemmungsgebiet', 'Anteil in Hochwassergefahrenzone', '%', 'Wasser', 'Hochwasser', 'Umwelt', 'higher_is_worse', 'percent', 1),
('DIST_TO_RIVER', 'Entfernung zum Gewässer', 'Distanz zum nächsten Fließgewässer', 'm', 'Wasser', 'Gewässer', 'Umwelt', 'neutral', 'number', 0),
('GROUNDWATER_RECHARGE', 'Grundwasserneubildung', 'Potenzielle Grundwasserneubildung', 'mm/Jahr', 'Wasser', 'Grundwasser', 'Umwelt', 'higher_is_better', 'number', 0),
('WATER_BODY_SHARE', 'Wasserfläche', 'Anteil Wasserflächen in der Zelle', '%', 'Wasser', 'Gewässer', 'Umwelt', 'neutral', 'percent', 1),

-- ===================== LANDNUTZUNG / VERSIEGELUNG =====================
('IMPERVIOUSNESS', 'Versiegelungsgrad', 'Anteil versiegelte Fläche', '%', 'Landnutzung', 'Versiegelung', 'Landnutzung', 'higher_is_worse', 'percent', 1),
('GREEN_SHARE', 'Grünflächenanteil', 'Anteil Grün- und Vegetationsflächen', '%', 'Landnutzung', 'Grünflächen', 'Landnutzung', 'higher_is_better', 'percent', 1),
('BUILTUP_SHARE', 'Bebauungsanteil', 'Anteil bebaute Fläche', '%', 'Landnutzung', 'Siedlung', 'Landnutzung', 'neutral', 'percent', 1),
('FOREST_SHARE', 'Waldanteil', 'Anteil Waldfläche', '%', 'Landnutzung', 'Vegetation', 'Landnutzung', 'higher_is_better', 'percent', 1),
('AGRICULTURE_SHARE', 'Landwirtschaftsanteil', 'Anteil landwirtschaftliche Fläche', '%', 'Landnutzung', 'Landwirtschaft', 'Landnutzung', 'neutral', 'percent', 1),
('TREE_CANOPY_SHARE', 'Baumkronenanteil', 'Anteil Baumkronenbedeckung', '%', 'Landnutzung', 'Vegetation', 'Landnutzung', 'higher_is_better', 'percent', 1),
('NDVI_SUMMER', 'Vegetationsindex Sommer', 'NDVI Durchschnitt Juni-August', 'Index', 'Landnutzung', 'Vegetation', 'Landnutzung', 'higher_is_better', 'index', 2),
('URBAN_GREEN_PER_CAPITA', 'Grünfläche pro Einwohner', 'Öffentliche Grünfläche pro Einwohner', 'm²/EW', 'Landnutzung', 'Grünflächen', 'Landnutzung', 'higher_is_better', 'number', 1),

-- ===================== DEMOGRAFIE =====================
('POPULATION', 'Bevölkerung', 'Einwohnerzahl in der Zelle', 'Einwohner', 'Demografie', 'Bevölkerung', 'Demografie', 'neutral', 'number', 0),
('POPULATION_DENSITY', 'Bevölkerungsdichte', 'Einwohner pro Quadratkilometer', 'EW/km²', 'Demografie', 'Bevölkerung', 'Demografie', 'neutral', 'number', 0),
('MEDIAN_AGE', 'Medianalter', 'Medianes Alter der Bevölkerung', 'Jahre', 'Demografie', 'Altersstruktur', 'Demografie', 'neutral', 'number', 1),
('SHARE_UNDER_18', 'Anteil unter 18', 'Anteil der Bevölkerung unter 18 Jahren', '%', 'Demografie', 'Altersstruktur', 'Demografie', 'neutral', 'percent', 1),
('SHARE_OVER_65', 'Anteil über 65', 'Anteil der Bevölkerung über 65 Jahren', '%', 'Demografie', 'Altersstruktur', 'Demografie', 'higher_is_worse', 'percent', 1),
('SHARE_OVER_80', 'Anteil über 80', 'Anteil der Bevölkerung über 80 Jahren', '%', 'Demografie', 'Altersstruktur', 'Demografie', 'higher_is_worse', 'percent', 1),
('HOUSEHOLDS', 'Haushalte', 'Anzahl Haushalte in der Zelle', 'Haushalte', 'Demografie', 'Haushalte', 'Demografie', 'neutral', 'number', 0),
('SINGLE_HOUSEHOLDS', 'Einpersonenhaushalte', 'Anteil Einpersonenhaushalte', '%', 'Demografie', 'Haushalte', 'Demografie', 'neutral', 'percent', 1),
('VULNERABILITY_INDEX', 'Vulnerabilitätsindex', 'Kombinierter Index für Klimavulnerabilität', 'Index', 'Demografie', 'Vulnerabilität', 'Demografie', 'higher_is_worse', 'index', 0),

-- ===================== LUFTQUALITÄT =====================
('NO2_MEAN', 'NO₂ Jahresmittel', 'Stickstoffdioxid Jahresmittelwert', 'µg/m³', 'Umwelt', 'Luftqualität', 'Umwelt', 'higher_is_worse', 'number', 1),
('PM25_MEAN', 'PM2.5 Jahresmittel', 'Feinstaub PM2.5 Jahresmittelwert', 'µg/m³', 'Umwelt', 'Luftqualität', 'Umwelt', 'higher_is_worse', 'number', 1),
('PM10_MEAN', 'PM10 Jahresmittel', 'Feinstaub PM10 Jahresmittelwert', 'µg/m³', 'Umwelt', 'Luftqualität', 'Umwelt', 'higher_is_worse', 'number', 1),
('O3_MEAN', 'Ozon Jahresmittel', 'Ozon Jahresmittelwert', 'µg/m³', 'Umwelt', 'Luftqualität', 'Umwelt', 'higher_is_worse', 'number', 1),
('O3_EXCEEDANCE_DAYS', 'Ozon Überschreitungstage', 'Tage mit Ozon über 120 µg/m³ (8h)', 'Tage/Jahr', 'Umwelt', 'Luftqualität', 'Umwelt', 'higher_is_worse', 'number', 0),
('AQI', 'Luftqualitätsindex', 'Europäischer Luftqualitätsindex', 'Index', 'Umwelt', 'Luftqualität', 'Umwelt', 'higher_is_worse', 'index', 0),
('NOISE_DAY', 'Lärmbelastung Tag', 'Durchschnittlicher Lärmpegel tagsüber', 'dB(A)', 'Umwelt', 'Lärm', 'Umwelt', 'higher_is_worse', 'number', 0),
('NOISE_NIGHT', 'Lärmbelastung Nacht', 'Durchschnittlicher Lärmpegel nachts', 'dB(A)', 'Umwelt', 'Lärm', 'Umwelt', 'higher_is_worse', 'number', 0),

-- ===================== MOBILITÄT =====================
('PT_STOPS_500M', 'ÖPNV-Haltestellen 500m', 'Anzahl ÖPNV-Haltestellen im 500m Radius', 'Anzahl', 'Mobilität', 'ÖPNV', 'Mobilität', 'higher_is_better', 'number', 0),
('RAIL_STATION_DIST', 'Entfernung Bahnhof', 'Distanz zum nächsten Bahnhof', 'm', 'Mobilität', 'ÖPNV', 'Mobilität', 'neutral', 'number', 0),
('BIKE_NETWORK_DENSITY', 'Radwegedichte', 'Länge Radwege pro Fläche', 'km/km²', 'Mobilität', 'Radverkehr', 'Mobilität', 'higher_is_better', 'number', 2),
('WALKABILITY_INDEX', 'Fußgängerfreundlichkeit', 'Index für fußgängerfreundliche Infrastruktur', 'Index', 'Mobilität', 'Fußverkehr', 'Mobilität', 'higher_is_better', 'index', 0),
('CAR_FREE_AREA_SHARE', 'Autofreie Zonen', 'Anteil autofreier/verkehrsberuhigter Bereiche', '%', 'Mobilität', 'Verkehrsberuhigung', 'Mobilität', 'higher_is_better', 'percent', 1),

-- ===================== INFRASTRUKTUR =====================
('HOSPITAL_DIST', 'Entfernung Krankenhaus', 'Distanz zum nächsten Krankenhaus', 'm', 'Infrastruktur', 'Gesundheit', 'Infrastruktur', 'neutral', 'number', 0),
('DOCTOR_DIST', 'Entfernung Arztpraxis', 'Distanz zur nächsten Arztpraxis', 'm', 'Infrastruktur', 'Gesundheit', 'Infrastruktur', 'neutral', 'number', 0),
('PHARMACY_DIST', 'Entfernung Apotheke', 'Distanz zur nächsten Apotheke', 'm', 'Infrastruktur', 'Gesundheit', 'Infrastruktur', 'neutral', 'number', 0),
('SCHOOL_DIST', 'Entfernung Schule', 'Distanz zur nächsten Schule', 'm', 'Infrastruktur', 'Bildung', 'Infrastruktur', 'neutral', 'number', 0),
('KINDERGARTEN_DIST', 'Entfernung Kindergarten', 'Distanz zum nächsten Kindergarten', 'm', 'Infrastruktur', 'Bildung', 'Infrastruktur', 'neutral', 'number', 0),
('SUPERMARKET_DIST', 'Entfernung Supermarkt', 'Distanz zum nächsten Supermarkt', 'm', 'Infrastruktur', 'Versorgung', 'Infrastruktur', 'neutral', 'number', 0),
('GREENSPACE_DIST', 'Entfernung Grünfläche', 'Distanz zur nächsten öffentlichen Grünfläche', 'm', 'Infrastruktur', 'Erholung', 'Infrastruktur', 'neutral', 'number', 0),
('PLAYGROUND_DIST', 'Entfernung Spielplatz', 'Distanz zum nächsten Spielplatz', 'm', 'Infrastruktur', 'Erholung', 'Infrastruktur', 'neutral', 'number', 0),
('COOLING_SPOTS_COUNT', 'Kühle Orte', 'Anzahl Kühlungsorte im 500m Radius', 'Anzahl', 'Infrastruktur', 'Klimaanpassung', 'Infrastruktur', 'higher_is_better', 'number', 0),
('AMENITIES_15MIN', 'Erreichbare Einrichtungen 15min', 'Anzahl erreichbarer Einrichtungen zu Fuß', 'Anzahl', 'Infrastruktur', 'Erreichbarkeit', 'Infrastruktur', 'higher_is_better', 'number', 0),

-- ===================== RISIKO =====================
('FLOOD_RISK_SCORE', 'Hochwasserrisiko', 'Kombinierter Hochwasserrisikoindex', 'Index', 'Risiko', 'Hochwasser', 'Risiko', 'higher_is_worse', 'index', 0),
('HEAT_RISK_SCORE', 'Hitzerisiko', 'Kombinierter Hitzerisikoindex', 'Index', 'Risiko', 'Hitze', 'Risiko', 'higher_is_worse', 'index', 0),
('WILDFIRE_RISK_SCORE', 'Waldbrandrisiko', 'Waldbrandrisikoindex', 'Index', 'Risiko', 'Waldbrand', 'Risiko', 'higher_is_worse', 'index', 0),
('DROUGHT_RISK_SCORE', 'Dürrerisiko', 'Dürrerisikoindex', 'Index', 'Risiko', 'Dürre', 'Risiko', 'higher_is_worse', 'index', 0),
('CLIMATE_ADAPTATION_SCORE', 'Klimaanpassungsindex', 'Grad der Klimaanpassungsmaßnahmen', 'Index', 'Risiko', 'Anpassung', 'Risiko', 'higher_is_better', 'index', 0),
('EXPOSURE_INDEX', 'Expositionsindex', 'Klimaexposition der Bevölkerung', 'Index', 'Risiko', 'Exposition', 'Risiko', 'higher_is_worse', 'index', 0),

-- ===================== KONTEXT =====================
('REGION_NAME', 'Regionsname', 'Name der Region/Gemeinde', '', 'Kontext', 'Administrativ', 'Kontext', 'neutral', 'text', 0),
('GRID_CODE', 'Gitterzellencode', 'EU3035 1km Gitterzellenkennung', '', 'Kontext', 'Administrativ', 'Kontext', 'neutral', 'text', 0),
('MUNICIPALITY', 'Gemeinde', 'Name der Gemeinde', '', 'Kontext', 'Administrativ', 'Kontext', 'neutral', 'text', 0),
('DISTRICT', 'Landkreis', 'Name des Landkreises', '', 'Kontext', 'Administrativ', 'Kontext', 'neutral', 'text', 0),
('FEDERAL_STATE', 'Bundesland', 'Name des Bundeslandes', '', 'Kontext', 'Administrativ', 'Kontext', 'neutral', 'text', 0)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  domain = EXCLUDED.domain,
  topic = EXCLUDED.topic,
  category = EXCLUDED.category,
  direction = EXCLUDED.direction,
  format = EXCLUDED.format,
  precision = EXCLUDED.precision;

-- ============================================================
-- PART 11: SEED INDICATOR-DATASET MAPPINGS
-- ============================================================

INSERT INTO public.indicator_datasets (indicator_code, dataset_key, connector_key, priority, params) VALUES
-- Climate indicators -> Copernicus
('TEMP_MEAN', 'copernicus_era5', 'climate', 100, '{"variable": "2m_temperature", "aggregation": "mean"}'),
('TEMP_MAX', 'copernicus_era5', 'climate', 100, '{"variable": "2m_temperature", "aggregation": "max"}'),
('TEMP_MIN', 'copernicus_era5', 'climate', 100, '{"variable": "2m_temperature", "aggregation": "min"}'),
('TEMP_SUMMER_MEAN', 'copernicus_era5', 'climate', 100, '{"variable": "2m_temperature", "months": [6,7,8], "aggregation": "mean"}'),
('HOT_DAYS_30C', 'copernicus_era5', 'climate', 100, '{"variable": "2m_temperature", "threshold": 30, "aggregation": "count_above"}'),
('TROPICAL_NIGHTS_20C', 'copernicus_era5', 'climate', 100, '{"variable": "2m_temperature_min", "threshold": 20, "aggregation": "count_above"}'),
('PRECIP_TOTAL', 'copernicus_era5', 'climate', 100, '{"variable": "total_precipitation", "aggregation": "sum"}'),
('PRECIP_INTENSE_DAYS', 'copernicus_era5', 'climate', 100, '{"variable": "total_precipitation", "threshold": 20, "aggregation": "count_above"}'),
('WARMING_VS_BASELINE', 'euro_cordex', 'climate', 100, '{"type": "delta"}'),
('CLIMATE_ANALOG_CITY', 'derived_neotopia', 'climate_analog', 100, '{}'),

-- Land use -> Copernicus Land
('IMPERVIOUSNESS', 'copernicus_hrl_imp', 'landuse', 100, '{}'),
('GREEN_SHARE', 'copernicus_clc', 'landuse', 100, '{"classes": [311,312,313,321,322,323,324]}'),
('BUILTUP_SHARE', 'copernicus_clc', 'landuse', 100, '{"classes": [111,112,121,122,123,124,131,132,133,141,142]}'),
('FOREST_SHARE', 'copernicus_clc', 'landuse', 100, '{"classes": [311,312,313]}'),
('AGRICULTURE_SHARE', 'copernicus_clc', 'landuse', 100, '{"classes": [211,212,213,221,222,223,231,241,242,243,244]}'),
('TREE_CANOPY_SHARE', 'copernicus_hrl_tree', 'landuse', 100, '{}'),
('WATER_BODY_SHARE', 'copernicus_clc', 'landuse', 100, '{"classes": [511,512,521,522,523]}'),

-- Demographics -> Eurostat/Zensus
('POPULATION', 'eurostat_geostat', 'demography', 100, '{}'),
('POPULATION', 'zensus_de', 'demography', 90, '{}'),
('POPULATION_DENSITY', 'eurostat_geostat', 'demography', 100, '{}'),
('MEDIAN_AGE', 'zensus_de', 'demography', 100, '{}'),
('SHARE_OVER_65', 'eurostat_geostat', 'demography', 100, '{}'),
('SHARE_OVER_80', 'zensus_de', 'demography', 100, '{}'),
('HOUSEHOLDS', 'zensus_de', 'demography', 100, '{}'),
('VULNERABILITY_INDEX', 'derived_neotopia', 'derived', 100, '{}'),

-- Air quality -> EEA
('NO2_MEAN', 'eea_aq', 'airquality', 100, '{"pollutant": "NO2"}'),
('NO2_MEAN', 'uba_aq', 'airquality', 90, '{"pollutant": "NO2"}'),
('PM25_MEAN', 'eea_aq', 'airquality', 100, '{"pollutant": "PM2.5"}'),
('PM10_MEAN', 'eea_aq', 'airquality', 100, '{"pollutant": "PM10"}'),
('O3_MEAN', 'eea_aq', 'airquality', 100, '{"pollutant": "O3"}'),
('AQI', 'eea_aq', 'airquality', 100, '{}'),

-- OSM-derived
('PT_STOPS_500M', 'osm', 'osm', 100, '{"query": "public_transport", "radius": 500}'),
('RAIL_STATION_DIST', 'osm', 'osm', 100, '{"query": "railway_station", "type": "nearest"}'),
('BIKE_NETWORK_DENSITY', 'osm', 'osm', 100, '{"query": "cycleway", "type": "density"}'),
('HOSPITAL_DIST', 'osm', 'osm', 100, '{"query": "hospital", "type": "nearest"}'),
('DOCTOR_DIST', 'osm', 'osm', 100, '{"query": "doctors", "type": "nearest"}'),
('PHARMACY_DIST', 'osm', 'osm', 100, '{"query": "pharmacy", "type": "nearest"}'),
('SCHOOL_DIST', 'osm', 'osm', 100, '{"query": "school", "type": "nearest"}'),
('KINDERGARTEN_DIST', 'osm', 'osm', 100, '{"query": "kindergarten", "type": "nearest"}'),
('SUPERMARKET_DIST', 'osm', 'osm', 100, '{"query": "supermarket", "type": "nearest"}'),
('GREENSPACE_DIST', 'osm', 'osm', 100, '{"query": "park", "type": "nearest"}'),
('PLAYGROUND_DIST', 'osm', 'osm', 100, '{"query": "playground", "type": "nearest"}'),
('COOLING_SPOTS_COUNT', 'osm', 'osm', 100, '{"query": "fountain|water_park|swimming_pool", "radius": 500}'),
('AMENITIES_15MIN', 'derived_neotopia', 'osm', 100, '{}'),
('WALKABILITY_INDEX', 'derived_neotopia', 'derived', 100, '{}'),

-- Flood risk -> JRC
('FLOOD_RISK_SCORE', 'jrc_flood', 'risk', 100, '{}'),
('FLOOD_PLAINS_SHARE', 'jrc_flood', 'risk', 100, '{}'),

-- Water -> OSM
('DIST_TO_RIVER', 'osm', 'osm', 100, '{"query": "waterway", "type": "nearest"}'),

-- Context
('REGION_NAME', 'derived_neotopia', 'context', 100, '{}'),
('GRID_CODE', 'derived_neotopia', 'context', 100, '{}')
ON CONFLICT (indicator_code, dataset_key) DO UPDATE SET
  connector_key = EXCLUDED.connector_key,
  priority = EXCLUDED.priority,
  params = EXCLUDED.params;

-- ============================================================
-- DONE
-- ============================================================

SELECT 'Migration complete. Indicators: ' || (SELECT COUNT(*) FROM public.indicators) || 
       ', Datasets: ' || (SELECT COUNT(*) FROM public.datasets) ||
       ', Mappings: ' || (SELECT COUNT(*) FROM public.indicator_datasets) AS status;
