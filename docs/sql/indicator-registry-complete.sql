-- =============================================================================
-- COMPLETE INDICATOR + DATASET REGISTRY MIGRATION
-- Run this in Supabase SQL Editor
-- =============================================================================

-- ============================================
-- 1. DATASETS TABLE (Data Sources Registry)
-- ============================================
CREATE TABLE IF NOT EXISTS public.datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  provider text NOT NULL,
  domain text NOT NULL,
  geographic_coverage text NOT NULL,
  access_type text NOT NULL,
  license text NOT NULL,
  attribution text NOT NULL,
  url text,
  notes text,
  update_frequency text,
  version text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.datasets IS 'Registry of all data sources used in the platform';
COMMENT ON COLUMN public.datasets.key IS 'Stable machine-readable key, e.g. copernicus_era5_land';
COMMENT ON COLUMN public.datasets.domain IS 'Primary domain: climate, demography, landuse, air, water, risk, mobility, economy, admin';
COMMENT ON COLUMN public.datasets.access_type IS 'api, bulk_download, tiles, files';

-- ============================================
-- 2. INDICATORS TABLE (Indicator Registry)
-- ============================================
CREATE TABLE IF NOT EXISTS public.indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  domain text NOT NULL,
  topic text,
  unit text,
  value_type text NOT NULL DEFAULT 'number',
  temporal_type text NOT NULL DEFAULT 'annual',
  direction text DEFAULT 'neutral',
  format text DEFAULT 'number',
  precision integer DEFAULT 1,
  requires_scenario boolean NOT NULL DEFAULT false,
  requires_period boolean NOT NULL DEFAULT false,
  default_ttl_days integer NOT NULL DEFAULT 180,
  sort_order integer NOT NULL DEFAULT 1000,
  category text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.indicators IS 'Master registry of all indicators';
COMMENT ON COLUMN public.indicators.code IS 'Stable machine-readable code';
COMMENT ON COLUMN public.indicators.value_type IS 'number, percent, index, category, text';
COMMENT ON COLUMN public.indicators.temporal_type IS 'static, annual, monthly, daily, scenario';
COMMENT ON COLUMN public.indicators.direction IS 'higher_is_better, higher_is_worse, neutral';

-- Add missing columns if table exists
DO $$
BEGIN
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
    ALTER TABLE public.indicators ADD COLUMN precision integer DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'value_type') THEN
    ALTER TABLE public.indicators ADD COLUMN value_type text NOT NULL DEFAULT 'number';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'temporal_type') THEN
    ALTER TABLE public.indicators ADD COLUMN temporal_type text NOT NULL DEFAULT 'annual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'requires_scenario') THEN
    ALTER TABLE public.indicators ADD COLUMN requires_scenario boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'requires_period') THEN
    ALTER TABLE public.indicators ADD COLUMN requires_period boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'default_ttl_days') THEN
    ALTER TABLE public.indicators ADD COLUMN default_ttl_days integer NOT NULL DEFAULT 180;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'indicators' AND column_name = 'sort_order') THEN
    ALTER TABLE public.indicators ADD COLUMN sort_order integer NOT NULL DEFAULT 1000;
  END IF;
END $$;

-- ============================================
-- 3. INDICATOR_DATASETS (Many-to-Many Mapping)
-- ============================================
CREATE TABLE IF NOT EXISTS public.indicator_datasets (
  indicator_id uuid NOT NULL REFERENCES public.indicators(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  connector_key text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  params jsonb,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (indicator_id, dataset_id)
);

COMMENT ON TABLE public.indicator_datasets IS 'Maps indicators to their data sources and connectors';
COMMENT ON COLUMN public.indicator_datasets.connector_key IS 'e.g. climate_c3s, demography_eurostat, landuse_copernicus';
COMMENT ON COLUMN public.indicator_datasets.priority IS 'Lower number = higher priority';

-- ============================================
-- 4. DATASET_VERSIONS (Provenance Tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS public.dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid REFERENCES public.datasets(id) ON DELETE CASCADE,
  fetched_at timestamptz DEFAULT now(),
  version text,
  valid_from date,
  valid_to date,
  metadata jsonb,
  notes text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.dataset_versions IS 'Tracks versions and refresh timestamps of datasets';

-- ============================================
-- 5. INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_datasets_domain ON public.datasets(domain);
CREATE INDEX IF NOT EXISTS idx_datasets_key ON public.datasets(key);
CREATE INDEX IF NOT EXISTS idx_indicators_domain ON public.indicators(domain);
CREATE INDEX IF NOT EXISTS idx_indicators_code ON public.indicators(code);
CREATE INDEX IF NOT EXISTS idx_indicators_category ON public.indicators(category);
CREATE INDEX IF NOT EXISTS idx_indicator_datasets_indicator ON public.indicator_datasets(indicator_id);
CREATE INDEX IF NOT EXISTS idx_indicator_datasets_dataset ON public.indicator_datasets(dataset_id);
CREATE INDEX IF NOT EXISTS idx_indicator_datasets_connector ON public.indicator_datasets(connector_key);

-- ============================================
-- 6. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicator_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataset_versions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Authenticated users can read datasets" ON public.datasets;
DROP POLICY IF EXISTS "Authenticated users can read indicators" ON public.indicators;
DROP POLICY IF EXISTS "Authenticated users can read indicator_datasets" ON public.indicator_datasets;
DROP POLICY IF EXISTS "Authenticated users can read dataset_versions" ON public.dataset_versions;
DROP POLICY IF EXISTS "Anyone can read datasets" ON public.datasets;
DROP POLICY IF EXISTS "Anyone can read indicators" ON public.indicators;
DROP POLICY IF EXISTS "Anyone can read indicator_datasets" ON public.indicator_datasets;
DROP POLICY IF EXISTS "Anyone can read dataset_versions" ON public.dataset_versions;

-- Create policies (allowing authenticated access)
CREATE POLICY "Authenticated users can read datasets" ON public.datasets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read indicators" ON public.indicators
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read indicator_datasets" ON public.indicator_datasets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read dataset_versions" ON public.dataset_versions
  FOR SELECT TO authenticated USING (true);

-- ============================================
-- 7. RPC FUNCTIONS
-- ============================================

-- List datasets with optional domain filter
CREATE OR REPLACE FUNCTION public.list_datasets(p_domain text DEFAULT NULL)
RETURNS SETOF public.datasets
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.datasets
  WHERE (p_domain IS NULL OR domain = p_domain)
  ORDER BY domain, name;
$$;

-- List indicators with optional domain and search filter
CREATE OR REPLACE FUNCTION public.list_indicators(
  p_domain text DEFAULT NULL,
  p_query text DEFAULT NULL
)
RETURNS SETOF public.indicators
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.indicators
  WHERE (p_domain IS NULL OR domain = p_domain)
    AND (p_query IS NULL OR p_query = '' OR 
         name ILIKE '%' || p_query || '%' OR 
         code ILIKE '%' || p_query || '%' OR
         description ILIKE '%' || p_query || '%')
  ORDER BY domain, sort_order, name;
$$;

-- Get dataset sources for specific indicator codes (for attribution)
CREATE OR REPLACE FUNCTION public.get_indicator_sources(p_indicator_codes text[])
RETURNS TABLE (
  indicator_code text,
  dataset_key text,
  dataset_name text,
  provider text,
  license text,
  attribution text,
  url text,
  connector_key text,
  priority integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    i.code AS indicator_code,
    d.key AS dataset_key,
    d.name AS dataset_name,
    d.provider,
    d.license,
    d.attribution,
    d.url,
    id.connector_key,
    id.priority
  FROM public.indicators i
  JOIN public.indicator_datasets id ON id.indicator_id = i.id
  JOIN public.datasets d ON d.id = id.dataset_id
  WHERE i.code = ANY(p_indicator_codes)
  ORDER BY i.code, id.priority;
$$;

-- ============================================
-- 8. SEED DATA: DATASETS
-- ============================================

-- Delete existing to avoid duplicates on re-run
DELETE FROM public.indicator_datasets;
DELETE FROM public.datasets;
DELETE FROM public.indicators WHERE code NOT IN ('population', 'median_age'); -- Keep any user-created

-- Copernicus Climate Data Store
INSERT INTO public.datasets (key, name, provider, domain, geographic_coverage, access_type, license, attribution, url, notes, update_frequency) VALUES
('copernicus_era5_land', 'ERA5-Land Hourly Data', 'Copernicus Climate Change Service (C3S)', 'climate', 'global', 'api', 'CC BY 4.0', 'Copernicus Climate Change Service (C3S): ERA5-Land hourly data from 1950 to present. Muñoz Sabater, J., (2019)', 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/reanalysis-era5-land', '0.1° resolution (~9km), hourly, 1950-present', 'monthly'),

('copernicus_era5', 'ERA5 Atmospheric Reanalysis', 'Copernicus Climate Change Service (C3S)', 'climate', 'global', 'api', 'CC BY 4.0', 'Copernicus Climate Change Service (C3S): ERA5 hourly data on single levels from 1940 to present. Hersbach et al., 2023', 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/reanalysis-era5-single-levels', '0.25° resolution, hourly, 1940-present', 'monthly'),

('copernicus_eurocordex', 'EURO-CORDEX Climate Projections', 'Copernicus Climate Change Service (C3S)', 'climate', 'EU', 'api', 'CC BY 4.0', 'Copernicus Climate Change Service (C3S): CORDEX regional climate model data on single levels. EURO-CORDEX initiative', 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/projections-cordex-domains-single-levels', 'EUR-11 (0.11°/~12km), bias-adjusted, CMIP5/CMIP6 scenarios', 'static'),

('copernicus_cmip6', 'CMIP6 Climate Projections', 'Copernicus Climate Change Service (C3S)', 'climate', 'global', 'api', 'CC BY 4.0', 'Copernicus Climate Change Service (C3S): CMIP6 climate projections. Eyring et al., 2016', 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/projections-cmip6', 'Multiple GCMs, SSP scenarios, 2015-2100', 'static'),

('copernicus_sis_heat', 'Heat Stress Indicators (SIS Heat)', 'Copernicus Climate Change Service (C3S)', 'climate', 'EU', 'api', 'CC BY 4.0', 'Copernicus Climate Change Service (C3S): Thermal comfort indices derived from ERA5. Di Napoli et al., 2022', 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/derived-utci-historical', 'UTCI, apparent temperature, 1979-present', 'annual');

-- Copernicus Land Monitoring Service
INSERT INTO public.datasets (key, name, provider, domain, geographic_coverage, access_type, license, attribution, url, notes, update_frequency) VALUES
('copernicus_corine', 'CORINE Land Cover', 'Copernicus Land Monitoring Service', 'landuse', 'EU', 'bulk_download', 'CC BY 4.0', 'Copernicus Land Monitoring Service: CORINE Land Cover. © European Union, Copernicus Land Monitoring Service', 'https://land.copernicus.eu/pan-european/corine-land-cover', '100m resolution, 44 classes, 1990-2018', '6 years'),

('copernicus_clc_plus', 'CLC+ Backbone', 'Copernicus Land Monitoring Service', 'landuse', 'EU', 'bulk_download', 'CC BY 4.0', 'Copernicus Land Monitoring Service: CLC+ Backbone. © European Union, Copernicus Land Monitoring Service', 'https://land.copernicus.eu/en/products/clc-backbone', '10m resolution, 2018/2021', '3 years'),

('copernicus_imperviousness', 'High Resolution Imperviousness', 'Copernicus Land Monitoring Service', 'landuse', 'EU', 'bulk_download', 'CC BY 4.0', 'Copernicus Land Monitoring Service: High Resolution Layer Imperviousness. © European Union', 'https://land.copernicus.eu/pan-european/high-resolution-layers/imperviousness', '10m resolution, 0-100% density, 2006-2018', '3 years'),

('copernicus_tree_cover', 'High Resolution Tree Cover Density', 'Copernicus Land Monitoring Service', 'landuse', 'EU', 'bulk_download', 'CC BY 4.0', 'Copernicus Land Monitoring Service: High Resolution Layer Tree Cover Density. © European Union', 'https://land.copernicus.eu/pan-european/high-resolution-layers/forests/tree-cover-density', '10m resolution, 0-100% density', '3 years'),

('copernicus_urban_atlas', 'Urban Atlas', 'Copernicus Land Monitoring Service', 'landuse', 'EU', 'bulk_download', 'CC BY 4.0', 'Copernicus Land Monitoring Service: Urban Atlas. © European Union, Copernicus Land Monitoring Service', 'https://land.copernicus.eu/local/urban-atlas', '2.5m-10m resolution, 27 classes, FUAs', '6 years'),

('copernicus_water', 'Water Bodies (EU-Hydro)', 'Copernicus Land Monitoring Service', 'water', 'EU', 'bulk_download', 'CC BY 4.0', 'Copernicus Land Monitoring Service: EU-Hydro River Network Database. © European Union', 'https://land.copernicus.eu/imagery-in-situ/eu-hydro', 'Vector network, catchments, water bodies', 'irregular');

-- European Environment Agency (EEA)
INSERT INTO public.datasets (key, name, provider, domain, geographic_coverage, access_type, license, attribution, url, notes, update_frequency) VALUES
('eea_airquality', 'Air Quality e-Reporting', 'European Environment Agency (EEA)', 'air', 'EU', 'api', 'CC BY 4.0', 'European Environment Agency: Air Quality e-Reporting (AQ e-Reporting). © EEA', 'https://www.eea.europa.eu/themes/air/air-quality-index', 'Validated station measurements, hourly/daily', 'hourly'),

('eea_noise', 'Noise Observation & Information Service', 'European Environment Agency (EEA)', 'air', 'EU', 'bulk_download', 'CC BY 4.0', 'European Environment Agency: Environmental Noise Directive (END) data. © EEA', 'https://www.eea.europa.eu/themes/human/noise', 'Strategic noise maps, Lden/Lnight', '5 years'),

('eea_water_quality', 'WISE Water Quality', 'European Environment Agency (EEA)', 'water', 'EU', 'api', 'CC BY 4.0', 'European Environment Agency: WISE Water Quality data. © EEA', 'https://www.eea.europa.eu/themes/water', 'WFD monitoring points, ecological status', 'annual'),

('eea_emissions', 'European Pollutant Release and Transfer Register', 'European Environment Agency (EEA)', 'air', 'EU', 'bulk_download', 'CC BY 4.0', 'European Environment Agency: E-PRTR. © EEA', 'https://www.eea.europa.eu/themes/industry', 'Facility-level emissions, annual', 'annual');

-- Eurostat / GISCO
INSERT INTO public.datasets (key, name, provider, domain, geographic_coverage, access_type, license, attribution, url, notes, update_frequency) VALUES
('eurostat_geostat', 'GEOSTAT Population Grid 1km', 'Eurostat / GISCO', 'demography', 'EU', 'bulk_download', 'CC BY 4.0', 'Eurostat GEOSTAT: Population grid based on census data. © European Union', 'https://ec.europa.eu/eurostat/web/gisco/geodata/reference-data/population-distribution-demography/geostat', '1km grid, census-based, 2011/2018/2021', 'census cycle'),

('eurostat_demography', 'Regional Demography Statistics', 'Eurostat', 'demography', 'EU', 'api', 'CC BY 4.0', 'Eurostat: Regional demographic statistics. © European Union', 'https://ec.europa.eu/eurostat/databrowser/explore/all/popul', 'NUTS-3 level, age structure, projections', 'annual'),

('eurostat_census', 'Census 2021 Grid Data', 'Eurostat / GISCO', 'demography', 'EU', 'bulk_download', 'CC BY 4.0', 'Eurostat: Census 2021 1km grid statistics. © European Union', 'https://ec.europa.eu/eurostat/web/gisco/geodata/reference-data/population-distribution-demography/census-grid-2021', '1km grid, detailed demographics', '10 years');

-- OpenStreetMap
INSERT INTO public.datasets (key, name, provider, domain, geographic_coverage, access_type, license, attribution, url, notes, update_frequency) VALUES
('osm', 'OpenStreetMap', 'OpenStreetMap Contributors', 'infrastructure', 'global', 'api', 'ODbL', '© OpenStreetMap contributors. Data available under the Open Database License.', 'https://www.openstreetmap.org/', 'POIs, networks, land use, buildings', 'continuous'),

('osm_nominatim', 'Nominatim Geocoding', 'OpenStreetMap Contributors', 'admin', 'global', 'api', 'ODbL', '© OpenStreetMap contributors. Nominatim geocoding service.', 'https://nominatim.openstreetmap.org/', 'Geocoding/reverse geocoding', 'continuous');

-- Risk and Flood Data
INSERT INTO public.datasets (key, name, provider, domain, geographic_coverage, access_type, license, attribution, url, notes, update_frequency) VALUES
('copernicus_efas', 'European Flood Awareness System', 'Copernicus Emergency Management Service', 'risk', 'EU', 'api', 'CC BY 4.0', 'Copernicus Emergency Management Service: European Flood Awareness System (EFAS). © European Union', 'https://www.efas.eu/', 'Real-time forecasts, historical floods', 'daily'),

('jrc_flood', 'JRC Global Flood Database', 'Joint Research Centre', 'risk', 'global', 'bulk_download', 'CC BY 4.0', 'European Commission Joint Research Centre: Global Flood Database. © European Union', 'https://global-flood-database.cloudtostreet.info/', 'Historical flood events, return periods', 'annual'),

('jrc_gdsl', 'JRC Global Human Settlement Layer', 'Joint Research Centre', 'landuse', 'global', 'bulk_download', 'CC BY 4.0', 'European Commission Joint Research Centre: Global Human Settlement Layer. © European Union', 'https://ghsl.jrc.ec.europa.eu/', 'Built-up area, population, degree of urbanisation', 'irregular');

-- German National Data
INSERT INTO public.datasets (key, name, provider, domain, geographic_coverage, access_type, license, attribution, url, notes, update_frequency) VALUES
('dwd_climate', 'DWD Climate Data Center', 'Deutscher Wetterdienst', 'climate', 'DE', 'api', 'CC BY 4.0', 'Deutscher Wetterdienst (DWD): Climate Data Center. © DWD', 'https://opendata.dwd.de/climate_environment/CDC/', 'Station + gridded data, 1km resolution', 'daily'),

('zensus_2022', 'Zensus 2022', 'Statistische Ämter des Bundes und der Länder', 'demography', 'DE', 'bulk_download', 'dl-de/by-2-0', 'Statistische Ämter des Bundes und der Länder: Zensus 2022. © destatis', 'https://www.zensus2022.de/', '100m grid, full demographics', '10 years'),

('uba_airquality', 'UBA Luftqualitätsdaten', 'Umweltbundesamt', 'air', 'DE', 'api', 'dl-de/by-2-0', 'Umweltbundesamt (UBA): Luftqualitätsdaten. © UBA', 'https://www.umweltbundesamt.de/daten/luft/luftdaten', 'Real-time + validated measurements', 'hourly'),

('bkg_admin', 'BKG Verwaltungsgebiete', 'Bundesamt für Kartographie und Geodäsie', 'admin', 'DE', 'bulk_download', 'dl-de/by-2-0', 'Bundesamt für Kartographie und Geodäsie: Verwaltungsgebiete 1:250.000. © GeoBasis-DE / BKG', 'https://gdz.bkg.bund.de/', 'NUTS, LAU, Gemeinden', 'annual');

-- ============================================
-- 9. SEED DATA: INDICATORS
-- ============================================

-- Clear and re-insert all indicators
DELETE FROM public.indicators;

-- DOMAIN: Klima (Climate)
INSERT INTO public.indicators (code, name, description, domain, topic, unit, value_type, temporal_type, direction, format, precision, requires_scenario, requires_period, sort_order, category) VALUES
-- Baseline Climate Indicators
('temp_mean_annual', 'Jahresmitteltemperatur', 'Mittlere Lufttemperatur im Jahresdurchschnitt', 'Klima', 'Temperatur', '°C', 'number', 'annual', 'neutral', 'number', 1, false, false, 100, 'Klima'),
('temp_max_annual', 'Maximale Jahrestemperatur', 'Höchste gemessene Temperatur im Jahr', 'Klima', 'Temperatur', '°C', 'number', 'annual', 'higher_is_worse', 'number', 1, false, false, 101, 'Klima'),
('temp_min_annual', 'Minimale Jahrestemperatur', 'Niedrigste gemessene Temperatur im Jahr', 'Klima', 'Temperatur', '°C', 'number', 'annual', 'neutral', 'number', 1, false, false, 102, 'Klima'),
('summer_days_25c', 'Sommertage (≥25°C)', 'Anzahl Tage mit Höchsttemperatur ≥25°C', 'Klima', 'Extremwetter', 'Tage', 'number', 'annual', 'higher_is_worse', 'number', 0, false, false, 110, 'Klima'),
('hot_days_30c', 'Heiße Tage (≥30°C)', 'Anzahl Tage mit Höchsttemperatur ≥30°C', 'Klima', 'Extremwetter', 'Tage', 'number', 'annual', 'higher_is_worse', 'number', 0, false, false, 111, 'Klima'),
('tropical_nights_20c', 'Tropennächte (≥20°C)', 'Anzahl Nächte mit Tiefsttemperatur ≥20°C', 'Klima', 'Extremwetter', 'Nächte', 'number', 'annual', 'higher_is_worse', 'number', 0, false, false, 112, 'Klima'),
('heat_wave_days', 'Hitzewellentage', 'Anzahl Tage in Hitzewellen (mind. 3 aufeinanderfolgende Tage >30°C)', 'Klima', 'Extremwetter', 'Tage', 'number', 'annual', 'higher_is_worse', 'number', 0, false, false, 113, 'Klima'),
('frost_days', 'Frosttage', 'Anzahl Tage mit Tiefsttemperatur <0°C', 'Klima', 'Extremwetter', 'Tage', 'number', 'annual', 'neutral', 'number', 0, false, false, 114, 'Klima'),
('ice_days', 'Eistage', 'Anzahl Tage mit Höchsttemperatur <0°C', 'Klima', 'Extremwetter', 'Tage', 'number', 'annual', 'neutral', 'number', 0, false, false, 115, 'Klima'),
('precip_annual', 'Jahresniederschlag', 'Gesamtniederschlag im Jahr', 'Klima', 'Niederschlag', 'mm', 'number', 'annual', 'neutral', 'number', 0, false, false, 120, 'Klima'),
('precip_days_1mm', 'Niederschlagstage (≥1mm)', 'Anzahl Tage mit mindestens 1mm Niederschlag', 'Klima', 'Niederschlag', 'Tage', 'number', 'annual', 'neutral', 'number', 0, false, false, 121, 'Klima'),
('precip_intense_20mm', 'Starkniederschlagstage (≥20mm)', 'Anzahl Tage mit mindestens 20mm Niederschlag', 'Klima', 'Niederschlag', 'Tage', 'number', 'annual', 'higher_is_worse', 'number', 0, false, false, 122, 'Klima'),
('dry_days_consecutive', 'Max. Trockenperiode', 'Längste Periode ohne Niederschlag (≥1mm)', 'Klima', 'Niederschlag', 'Tage', 'number', 'annual', 'higher_is_worse', 'number', 0, false, false, 123, 'Klima'),
('cooling_degree_days', 'Kühlgradtage', 'Summe der Tage × Grad über 18°C Basis', 'Klima', 'Energiebedarf', 'Gradtage', 'number', 'annual', 'higher_is_worse', 'number', 0, false, false, 130, 'Klima'),
('heating_degree_days', 'Heizgradtage', 'Summe der Tage × Grad unter 15°C Basis', 'Klima', 'Energiebedarf', 'Gradtage', 'number', 'annual', 'neutral', 'number', 0, false, false, 131, 'Klima'),
('utci_mean_summer', 'UTCI Sommermittel', 'Universal Thermal Climate Index im Sommer', 'Klima', 'Wärmebelastung', '°C', 'number', 'annual', 'higher_is_worse', 'number', 1, false, false, 140, 'Klima'),
('pet_mean_summer', 'PET Sommermittel', 'Physiologisch Äquivalente Temperatur im Sommer', 'Klima', 'Wärmebelastung', '°C', 'number', 'annual', 'higher_is_worse', 'number', 1, false, false, 141, 'Klima'),

-- Climate Projections (require scenario + period)
('temp_mean_projection', 'Projizierte Jahresmitteltemperatur', 'Klimaprojektion der mittleren Jahrestemperatur', 'Klima', 'Projektion', '°C', 'number', 'scenario', 'neutral', 'number', 1, true, true, 200, 'Klima'),
('temp_delta_vs_baseline', 'Temperaturänderung vs. Referenz', 'Änderung gegenüber Referenzperiode 1991-2020', 'Klima', 'Projektion', '°C', 'number', 'scenario', 'higher_is_worse', 'number', 1, true, true, 201, 'Klima'),
('hot_days_projection', 'Projizierte Heiße Tage', 'Klimaprojektion der Anzahl heißer Tage (≥30°C)', 'Klima', 'Projektion', 'Tage', 'number', 'scenario', 'higher_is_worse', 'number', 0, true, true, 210, 'Klima'),
('hot_days_delta', 'Änderung Heiße Tage', 'Änderung der heißen Tage gegenüber Referenzperiode', 'Klima', 'Projektion', 'Tage', 'number', 'scenario', 'higher_is_worse', 'number', 0, true, true, 211, 'Klima'),
('tropical_nights_projection', 'Projizierte Tropennächte', 'Klimaprojektion der Anzahl Tropennächte (≥20°C)', 'Klima', 'Projektion', 'Nächte', 'number', 'scenario', 'higher_is_worse', 'number', 0, true, true, 212, 'Klima'),
('tropical_nights_delta', 'Änderung Tropennächte', 'Änderung der Tropennächte gegenüber Referenzperiode', 'Klima', 'Projektion', 'Nächte', 'number', 'scenario', 'higher_is_worse', 'number', 0, true, true, 213, 'Klima'),
('climate_analog_city', 'Klimaanalog-Stadt', 'Stadt mit ähnlichem heutigem Klima wie projiziert', 'Klima', 'Projektion', '', 'text', 'scenario', 'neutral', 'text', 0, true, true, 250, 'Klima');

-- DOMAIN: Wasser (Water)
INSERT INTO public.indicators (code, name, description, domain, topic, unit, value_type, temporal_type, direction, format, precision, requires_scenario, requires_period, sort_order, category) VALUES
('runoff_annual', 'Jährlicher Abfluss', 'Geschätzter jährlicher Oberflächenabfluss', 'Wasser', 'Hydrologie', 'mm', 'number', 'annual', 'neutral', 'number', 0, false, false, 300, 'Wasser'),
('groundwater_recharge', 'Grundwasserneubildung', 'Geschätzte jährliche Grundwasserneubildung', 'Wasser', 'Hydrologie', 'mm', 'number', 'annual', 'higher_is_better', 'number', 0, false, false, 301, 'Wasser'),
('flood_return_period', 'Hochwasser-Wiederkehrperiode', 'Geschätzte Wiederkehrperiode für Hochwasser', 'Wasser', 'Risiko', 'Jahre', 'number', 'static', 'higher_is_better', 'number', 0, false, false, 310, 'Wasser'),
('distance_to_river', 'Entfernung zum Gewässer', 'Distanz zum nächsten Fließgewässer', 'Wasser', 'Infrastruktur', 'm', 'number', 'static', 'neutral', 'number', 0, false, false, 320, 'Wasser'),
('water_body_share', 'Wasserflächen-Anteil', 'Anteil von Wasserflächen an der Gesamtfläche', 'Wasser', 'Landnutzung', '%', 'percent', 'static', 'neutral', 'percent', 1, false, false, 321, 'Wasser'),
('imperviousness', 'Versiegelungsgrad', 'Anteil versiegelter Flächen (Gebäude, Straßen)', 'Wasser', 'Versiegelung', '%', 'percent', 'annual', 'higher_is_worse', 'percent', 1, false, false, 330, 'Wasser'),
('sponge_city_index', 'Schwammstadt-Index', 'Bewertung der Regenwasseraufnahmefähigkeit', 'Wasser', 'Anpassung', 'Index', 'index', 'static', 'higher_is_better', 'number', 2, false, false, 340, 'Wasser');

-- DOMAIN: Landnutzung (Land Use)
INSERT INTO public.indicators (code, name, description, domain, topic, unit, value_type, temporal_type, direction, format, precision, requires_scenario, requires_period, sort_order, category) VALUES
('landcover_urban', 'Urbane Flächen', 'Anteil bebauter/urbaner Flächen', 'Landnutzung', 'Bodenbedeckung', '%', 'percent', 'annual', 'neutral', 'percent', 1, false, false, 400, 'Landnutzung'),
('landcover_agriculture', 'Landwirtschaftliche Flächen', 'Anteil landwirtschaftlich genutzter Flächen', 'Landnutzung', 'Bodenbedeckung', '%', 'percent', 'annual', 'neutral', 'percent', 1, false, false, 401, 'Landnutzung'),
('landcover_forest', 'Waldflächen', 'Anteil von Waldflächen', 'Landnutzung', 'Bodenbedeckung', '%', 'percent', 'annual', 'higher_is_better', 'percent', 1, false, false, 402, 'Landnutzung'),
('landcover_water', 'Wasserflächen', 'Anteil von Wasserflächen', 'Landnutzung', 'Bodenbedeckung', '%', 'percent', 'annual', 'neutral', 'percent', 1, false, false, 403, 'Landnutzung'),
('green_space_share', 'Grünflächenanteil', 'Anteil von Grün- und Freiflächen', 'Landnutzung', 'Grünflächen', '%', 'percent', 'annual', 'higher_is_better', 'percent', 1, false, false, 410, 'Landnutzung'),
('tree_cover_density', 'Baumbedeckungsgrad', 'Anteil der Baumkronenabdeckung', 'Landnutzung', 'Grünflächen', '%', 'percent', 'annual', 'higher_is_better', 'percent', 1, false, false, 411, 'Landnutzung'),
('ndvi_summer', 'NDVI Sommer', 'Vegetationsindex im Sommer (Normalized Difference Vegetation Index)', 'Landnutzung', 'Vegetation', 'Index', 'index', 'annual', 'higher_is_better', 'number', 2, false, false, 420, 'Landnutzung'),
('urban_heat_island', 'Städtische Wärmeinsel', 'Temperaturunterschied zu ländlichem Umland', 'Landnutzung', 'Mikroklima', '°C', 'number', 'annual', 'higher_is_worse', 'number', 1, false, false, 430, 'Landnutzung');

-- DOMAIN: Demografie (Demography)
INSERT INTO public.indicators (code, name, description, domain, topic, unit, value_type, temporal_type, direction, format, precision, requires_scenario, requires_period, sort_order, category) VALUES
('population_total', 'Bevölkerung gesamt', 'Gesamtbevölkerung in der Rasterzelle', 'Demografie', 'Bevölkerung', 'Einwohner', 'number', 'annual', 'neutral', 'number', 0, false, false, 500, 'Demografie'),
('population_density', 'Bevölkerungsdichte', 'Einwohner pro Quadratkilometer', 'Demografie', 'Bevölkerung', 'Einw./km²', 'number', 'annual', 'neutral', 'number', 0, false, false, 501, 'Demografie'),
('median_age', 'Medianalter', 'Medianalter der Bevölkerung', 'Demografie', 'Altersstruktur', 'Jahre', 'number', 'annual', 'neutral', 'number', 1, false, false, 510, 'Demografie'),
('share_under_18', 'Anteil unter 18', 'Anteil der Bevölkerung unter 18 Jahren', 'Demografie', 'Altersstruktur', '%', 'percent', 'annual', 'neutral', 'percent', 1, false, false, 511, 'Demografie'),
('share_over_65', 'Anteil über 65', 'Anteil der Bevölkerung über 65 Jahren', 'Demografie', 'Altersstruktur', '%', 'percent', 'annual', 'neutral', 'percent', 1, false, false, 512, 'Demografie'),
('share_over_80', 'Anteil über 80', 'Anteil der Bevölkerung über 80 Jahren', 'Demografie', 'Altersstruktur', '%', 'percent', 'annual', 'neutral', 'percent', 1, false, false, 513, 'Demografie'),
('households_total', 'Haushalte gesamt', 'Anzahl der Haushalte', 'Demografie', 'Haushalte', 'Haushalte', 'number', 'annual', 'neutral', 'number', 0, false, false, 520, 'Demografie'),
('avg_household_size', 'Durchschn. Haushaltsgröße', 'Durchschnittliche Anzahl Personen pro Haushalt', 'Demografie', 'Haushalte', 'Personen', 'number', 'annual', 'neutral', 'number', 2, false, false, 521, 'Demografie'),
('vulnerability_index', 'Vulnerabilitätsindex', 'Kombinierter Index der sozialen Verwundbarkeit gegenüber Klimarisiken', 'Demografie', 'Vulnerabilität', 'Index', 'index', 'annual', 'higher_is_worse', 'number', 2, false, false, 590, 'Demografie');

-- DOMAIN: Umwelt (Environment / Air Quality)
INSERT INTO public.indicators (code, name, description, domain, topic, unit, value_type, temporal_type, direction, format, precision, requires_scenario, requires_period, sort_order, category) VALUES
('no2_annual', 'NO₂ Jahresmittel', 'Stickstoffdioxid-Jahresmittelwert', 'Umwelt', 'Luftqualität', 'µg/m³', 'number', 'annual', 'higher_is_worse', 'number', 1, false, false, 600, 'Umwelt'),
('pm25_annual', 'PM2.5 Jahresmittel', 'Feinstaub PM2.5 Jahresmittelwert', 'Umwelt', 'Luftqualität', 'µg/m³', 'number', 'annual', 'higher_is_worse', 'number', 1, false, false, 601, 'Umwelt'),
('pm10_annual', 'PM10 Jahresmittel', 'Feinstaub PM10 Jahresmittelwert', 'Umwelt', 'Luftqualität', 'µg/m³', 'number', 'annual', 'higher_is_worse', 'number', 1, false, false, 602, 'Umwelt'),
('o3_max_8h', 'O₃ max. 8h-Mittel', 'Höchster 8-Stunden-Mittelwert Ozon im Jahr', 'Umwelt', 'Luftqualität', 'µg/m³', 'number', 'annual', 'higher_is_worse', 'number', 1, false, false, 603, 'Umwelt'),
('noise_lden', 'Lärmindex Lden', '24h-Lärmindex (Tag-Abend-Nacht)', 'Umwelt', 'Lärm', 'dB(A)', 'number', 'annual', 'higher_is_worse', 'number', 0, false, false, 610, 'Umwelt'),
('noise_lnight', 'Lärmindex Lnight', 'Nacht-Lärmindex (22-6 Uhr)', 'Umwelt', 'Lärm', 'dB(A)', 'number', 'annual', 'higher_is_worse', 'number', 0, false, false, 611, 'Umwelt'),
('air_quality_index', 'Luftqualitätsindex', 'Europäischer Luftqualitätsindex (1-5)', 'Umwelt', 'Luftqualität', 'Index', 'index', 'daily', 'higher_is_worse', 'number', 0, false, false, 620, 'Umwelt');

-- DOMAIN: Mobilität (Mobility)
INSERT INTO public.indicators (code, name, description, domain, topic, unit, value_type, temporal_type, direction, format, precision, requires_scenario, requires_period, sort_order, category) VALUES
('pt_stops_500m', 'ÖPNV-Haltestellen (500m)', 'Anzahl ÖPNV-Haltestellen im Umkreis von 500m', 'Mobilität', 'ÖPNV', 'Anzahl', 'number', 'static', 'higher_is_better', 'number', 0, false, false, 700, 'Mobilität'),
('pt_stops_1km', 'ÖPNV-Haltestellen (1km)', 'Anzahl ÖPNV-Haltestellen im Umkreis von 1km', 'Mobilität', 'ÖPNV', 'Anzahl', 'number', 'static', 'higher_is_better', 'number', 0, false, false, 701, 'Mobilität'),
('rail_station_dist', 'Entfernung Bahnhof', 'Distanz zur nächsten Bahn-/S-Bahn-Station', 'Mobilität', 'ÖPNV', 'm', 'number', 'static', 'higher_is_worse', 'number', 0, false, false, 710, 'Mobilität'),
('bike_network_density', 'Radwegedichte', 'Länge des Radwegenetzes pro km²', 'Mobilität', 'Radverkehr', 'm/km²', 'number', 'static', 'higher_is_better', 'number', 0, false, false, 720, 'Mobilität'),
('walkability_index', 'Fußgängerfreundlichkeit', 'Index der fußläufigen Erreichbarkeit von Zielen', 'Mobilität', 'Fußverkehr', 'Index', 'index', 'static', 'higher_is_better', 'number', 2, false, false, 730, 'Mobilität'),
('car_dependency', 'Autoabhängigkeit', 'Index der Abhängigkeit vom motorisierten Individualverkehr', 'Mobilität', 'MIV', 'Index', 'index', 'static', 'higher_is_worse', 'number', 2, false, false, 740, 'Mobilität');

-- DOMAIN: Infrastruktur (Infrastructure)
INSERT INTO public.indicators (code, name, description, domain, topic, unit, value_type, temporal_type, direction, format, precision, requires_scenario, requires_period, sort_order, category) VALUES
('hospital_dist', 'Entfernung Krankenhaus', 'Distanz zum nächsten Krankenhaus', 'Infrastruktur', 'Gesundheit', 'm', 'number', 'static', 'higher_is_worse', 'number', 0, false, false, 800, 'Infrastruktur'),
('pharmacy_dist', 'Entfernung Apotheke', 'Distanz zur nächsten Apotheke', 'Infrastruktur', 'Gesundheit', 'm', 'number', 'static', 'higher_is_worse', 'number', 0, false, false, 801, 'Infrastruktur'),
('doctor_dist', 'Entfernung Arztpraxis', 'Distanz zur nächsten Hausarztpraxis', 'Infrastruktur', 'Gesundheit', 'm', 'number', 'static', 'higher_is_worse', 'number', 0, false, false, 802, 'Infrastruktur'),
('school_dist', 'Entfernung Grundschule', 'Distanz zur nächsten Grundschule', 'Infrastruktur', 'Bildung', 'm', 'number', 'static', 'higher_is_worse', 'number', 0, false, false, 810, 'Infrastruktur'),
('kindergarten_dist', 'Entfernung Kindergarten', 'Distanz zum nächsten Kindergarten', 'Infrastruktur', 'Bildung', 'm', 'number', 'static', 'higher_is_worse', 'number', 0, false, false, 811, 'Infrastruktur'),
('supermarket_dist', 'Entfernung Supermarkt', 'Distanz zum nächsten Supermarkt', 'Infrastruktur', 'Nahversorgung', 'm', 'number', 'static', 'higher_is_worse', 'number', 0, false, false, 820, 'Infrastruktur'),
('greenspace_dist', 'Entfernung Grünfläche', 'Distanz zur nächsten öffentlichen Grünfläche', 'Infrastruktur', 'Erholung', 'm', 'number', 'static', 'higher_is_worse', 'number', 0, false, false, 830, 'Infrastruktur'),
('cooling_spots_1km', 'Kühlungsorte (1km)', 'Anzahl kühler Orte (Parks, Wälder, Wasserflächen) im Umkreis von 1km', 'Infrastruktur', 'Klimaanpassung', 'Anzahl', 'number', 'static', 'higher_is_better', 'number', 0, false, false, 840, 'Infrastruktur');

-- DOMAIN: Risiko (Risk)
INSERT INTO public.indicators (code, name, description, domain, topic, unit, value_type, temporal_type, direction, format, precision, requires_scenario, requires_period, sort_order, category) VALUES
('flood_risk_score', 'Hochwasserrisiko', 'Kombinierter Hochwasser-Risikoindex', 'Risiko', 'Hochwasser', 'Index', 'index', 'static', 'higher_is_worse', 'number', 2, false, false, 900, 'Risiko'),
('flood_zone_100', 'In HQ100-Zone', 'Liegt im statistischen 100-jährigen Hochwassergebiet', 'Risiko', 'Hochwasser', '', 'category', 'static', 'higher_is_worse', 'category', 0, false, false, 901, 'Risiko'),
('heat_risk_score', 'Hitzerisiko', 'Kombinierter Hitze-Risikoindex basierend auf Exposition und Vulnerabilität', 'Risiko', 'Hitze', 'Index', 'index', 'annual', 'higher_is_worse', 'number', 2, false, false, 910, 'Risiko'),
('heat_risk_projection', 'Projiziertes Hitzerisiko', 'Projizierter Hitze-Risikoindex für Zukunftsszenarien', 'Risiko', 'Hitze', 'Index', 'index', 'scenario', 'higher_is_worse', 'number', 2, true, true, 911, 'Risiko'),
('drought_risk_score', 'Dürrerisiko', 'Kombinierter Dürre-Risikoindex', 'Risiko', 'Dürre', 'Index', 'index', 'annual', 'higher_is_worse', 'number', 2, false, false, 920, 'Risiko'),
('wildfire_risk_score', 'Waldbrandrisiko', 'Index des Waldbrandrisikos', 'Risiko', 'Waldbrand', 'Index', 'index', 'annual', 'higher_is_worse', 'number', 2, false, false, 930, 'Risiko'),
('combined_climate_risk', 'Kombiniertes Klimarisiko', 'Aggregierter Index aller Klimarisiken', 'Risiko', 'Gesamt', 'Index', 'index', 'annual', 'higher_is_worse', 'number', 2, false, false, 990, 'Risiko');

-- DOMAIN: Kontext (Context / Admin)
INSERT INTO public.indicators (code, name, description, domain, topic, unit, value_type, temporal_type, direction, format, precision, requires_scenario, requires_period, sort_order, category) VALUES
('region_name', 'Regionsname', 'Name der Region oder Gemeinde', 'Kontext', 'Verwaltung', '', 'text', 'static', 'neutral', 'text', 0, false, false, 1000, 'Kontext'),
('grid_code', 'Rastercode', 'EU3035 1km Rasterzellencode', 'Kontext', 'Verwaltung', '', 'text', 'static', 'neutral', 'text', 0, false, false, 1001, 'Kontext'),
('nuts3_code', 'NUTS-3 Code', 'Eurostat NUTS-3 Regionsschlüssel', 'Kontext', 'Verwaltung', '', 'text', 'static', 'neutral', 'text', 0, false, false, 1010, 'Kontext'),
('lau_code', 'LAU Code', 'Gemeindeschlüssel (Local Administrative Unit)', 'Kontext', 'Verwaltung', '', 'text', 'static', 'neutral', 'text', 0, false, false, 1011, 'Kontext'),
('centroid_lat', 'Breitengrad', 'Geografischer Mittelpunkt (Latitude)', 'Kontext', 'Geografie', '°', 'number', 'static', 'neutral', 'number', 6, false, false, 1020, 'Kontext'),
('centroid_lon', 'Längengrad', 'Geografischer Mittelpunkt (Longitude)', 'Kontext', 'Geografie', '°', 'number', 'static', 'neutral', 'number', 6, false, false, 1021, 'Kontext'),
('elevation_mean', 'Mittlere Höhe', 'Durchschnittliche Höhe über Meeresspiegel', 'Kontext', 'Geografie', 'm', 'number', 'static', 'neutral', 'number', 0, false, false, 1030, 'Kontext');

-- ============================================
-- 10. SEED DATA: INDICATOR_DATASETS MAPPINGS
-- ============================================

-- Helper function to get indicator ID by code
CREATE OR REPLACE FUNCTION get_indicator_id(p_code text) RETURNS uuid AS $$
  SELECT id FROM public.indicators WHERE code = p_code;
$$ LANGUAGE sql STABLE;

-- Helper function to get dataset ID by key
CREATE OR REPLACE FUNCTION get_dataset_id(p_key text) RETURNS uuid AS $$
  SELECT id FROM public.datasets WHERE key = p_key;
$$ LANGUAGE sql STABLE;

-- Climate indicators -> Copernicus datasets
INSERT INTO public.indicator_datasets (indicator_id, dataset_id, connector_key, priority) VALUES
-- Baseline climate from ERA5-Land
(get_indicator_id('temp_mean_annual'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('temp_max_annual'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('temp_min_annual'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('summer_days_25c'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('hot_days_30c'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('tropical_nights_20c'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('heat_wave_days'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('frost_days'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('ice_days'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('precip_annual'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('precip_days_1mm'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('precip_intense_20mm'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('dry_days_consecutive'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('cooling_degree_days'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),
(get_indicator_id('heating_degree_days'), get_dataset_id('copernicus_era5_land'), 'climate_era5', 10),

-- Climate projections from EURO-CORDEX
(get_indicator_id('temp_mean_projection'), get_dataset_id('copernicus_eurocordex'), 'climate_cordex', 10),
(get_indicator_id('temp_delta_vs_baseline'), get_dataset_id('copernicus_eurocordex'), 'climate_cordex', 10),
(get_indicator_id('hot_days_projection'), get_dataset_id('copernicus_eurocordex'), 'climate_cordex', 10),
(get_indicator_id('hot_days_delta'), get_dataset_id('copernicus_eurocordex'), 'climate_cordex', 10),
(get_indicator_id('tropical_nights_projection'), get_dataset_id('copernicus_eurocordex'), 'climate_cordex', 10),
(get_indicator_id('tropical_nights_delta'), get_dataset_id('copernicus_eurocordex'), 'climate_cordex', 10),
(get_indicator_id('climate_analog_city'), get_dataset_id('copernicus_eurocordex'), 'climate_analog', 10),

-- Heat stress from SIS Heat
(get_indicator_id('utci_mean_summer'), get_dataset_id('copernicus_sis_heat'), 'climate_utci', 10),
(get_indicator_id('pet_mean_summer'), get_dataset_id('copernicus_sis_heat'), 'climate_utci', 10),

-- DWD as secondary source for Germany
(get_indicator_id('temp_mean_annual'), get_dataset_id('dwd_climate'), 'climate_dwd', 20),
(get_indicator_id('hot_days_30c'), get_dataset_id('dwd_climate'), 'climate_dwd', 20),
(get_indicator_id('tropical_nights_20c'), get_dataset_id('dwd_climate'), 'climate_dwd', 20);

-- Demography indicators -> Eurostat
INSERT INTO public.indicator_datasets (indicator_id, dataset_id, connector_key, priority) VALUES
(get_indicator_id('population_total'), get_dataset_id('eurostat_geostat'), 'demography_eurostat', 10),
(get_indicator_id('population_density'), get_dataset_id('eurostat_geostat'), 'demography_eurostat', 10),
(get_indicator_id('median_age'), get_dataset_id('eurostat_demography'), 'demography_eurostat', 10),
(get_indicator_id('share_under_18'), get_dataset_id('eurostat_demography'), 'demography_eurostat', 10),
(get_indicator_id('share_over_65'), get_dataset_id('eurostat_demography'), 'demography_eurostat', 10),
(get_indicator_id('share_over_80'), get_dataset_id('eurostat_demography'), 'demography_eurostat', 10),
(get_indicator_id('households_total'), get_dataset_id('eurostat_census'), 'demography_census', 10),
(get_indicator_id('avg_household_size'), get_dataset_id('eurostat_census'), 'demography_census', 10),

-- German Zensus as higher priority for DE
(get_indicator_id('population_total'), get_dataset_id('zensus_2022'), 'demography_zensus', 5),
(get_indicator_id('population_density'), get_dataset_id('zensus_2022'), 'demography_zensus', 5);

-- Land use indicators -> Copernicus Land
INSERT INTO public.indicator_datasets (indicator_id, dataset_id, connector_key, priority) VALUES
(get_indicator_id('landcover_urban'), get_dataset_id('copernicus_corine'), 'landuse_corine', 10),
(get_indicator_id('landcover_agriculture'), get_dataset_id('copernicus_corine'), 'landuse_corine', 10),
(get_indicator_id('landcover_forest'), get_dataset_id('copernicus_corine'), 'landuse_corine', 10),
(get_indicator_id('landcover_water'), get_dataset_id('copernicus_corine'), 'landuse_corine', 10),
(get_indicator_id('green_space_share'), get_dataset_id('copernicus_urban_atlas'), 'landuse_urban_atlas', 10),
(get_indicator_id('tree_cover_density'), get_dataset_id('copernicus_tree_cover'), 'landuse_hrl', 10),
(get_indicator_id('imperviousness'), get_dataset_id('copernicus_imperviousness'), 'landuse_hrl', 10),
(get_indicator_id('water_body_share'), get_dataset_id('copernicus_corine'), 'landuse_corine', 10),

-- CLC+ as higher resolution alternative
(get_indicator_id('landcover_urban'), get_dataset_id('copernicus_clc_plus'), 'landuse_clc_plus', 5),
(get_indicator_id('green_space_share'), get_dataset_id('copernicus_clc_plus'), 'landuse_clc_plus', 5);

-- Environment / Air quality -> EEA
INSERT INTO public.indicator_datasets (indicator_id, dataset_id, connector_key, priority) VALUES
(get_indicator_id('no2_annual'), get_dataset_id('eea_airquality'), 'air_eea', 10),
(get_indicator_id('pm25_annual'), get_dataset_id('eea_airquality'), 'air_eea', 10),
(get_indicator_id('pm10_annual'), get_dataset_id('eea_airquality'), 'air_eea', 10),
(get_indicator_id('o3_max_8h'), get_dataset_id('eea_airquality'), 'air_eea', 10),
(get_indicator_id('air_quality_index'), get_dataset_id('eea_airquality'), 'air_eea', 10),
(get_indicator_id('noise_lden'), get_dataset_id('eea_noise'), 'noise_eea', 10),
(get_indicator_id('noise_lnight'), get_dataset_id('eea_noise'), 'noise_eea', 10),

-- UBA as German source
(get_indicator_id('no2_annual'), get_dataset_id('uba_airquality'), 'air_uba', 5),
(get_indicator_id('pm25_annual'), get_dataset_id('uba_airquality'), 'air_uba', 5),
(get_indicator_id('pm10_annual'), get_dataset_id('uba_airquality'), 'air_uba', 5);

-- Infrastructure / Mobility -> OSM
INSERT INTO public.indicator_datasets (indicator_id, dataset_id, connector_key, priority) VALUES
(get_indicator_id('pt_stops_500m'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('pt_stops_1km'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('rail_station_dist'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('bike_network_density'), get_dataset_id('osm'), 'osm_network', 10),
(get_indicator_id('hospital_dist'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('pharmacy_dist'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('doctor_dist'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('school_dist'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('kindergarten_dist'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('supermarket_dist'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('greenspace_dist'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('cooling_spots_1km'), get_dataset_id('osm'), 'osm_poi', 10),
(get_indicator_id('distance_to_river'), get_dataset_id('osm'), 'osm_poi', 10);

-- Risk indicators -> Multiple sources
INSERT INTO public.indicator_datasets (indicator_id, dataset_id, connector_key, priority) VALUES
(get_indicator_id('flood_risk_score'), get_dataset_id('copernicus_efas'), 'risk_efas', 10),
(get_indicator_id('flood_zone_100'), get_dataset_id('jrc_flood'), 'risk_jrc', 10),
(get_indicator_id('heat_risk_score'), get_dataset_id('copernicus_era5_land'), 'risk_heat', 10),
(get_indicator_id('heat_risk_projection'), get_dataset_id('copernicus_eurocordex'), 'risk_heat_projection', 10);

-- Water indicators
INSERT INTO public.indicator_datasets (indicator_id, dataset_id, connector_key, priority) VALUES
(get_indicator_id('runoff_annual'), get_dataset_id('copernicus_era5_land'), 'water_era5', 10),
(get_indicator_id('groundwater_recharge'), get_dataset_id('copernicus_era5_land'), 'water_era5', 10),
(get_indicator_id('flood_return_period'), get_dataset_id('copernicus_efas'), 'water_efas', 10);

-- Context indicators
INSERT INTO public.indicator_datasets (indicator_id, dataset_id, connector_key, priority) VALUES
(get_indicator_id('region_name'), get_dataset_id('osm_nominatim'), 'context_nominatim', 10),
(get_indicator_id('grid_code'), get_dataset_id('eurostat_geostat'), 'context_grid', 10),
(get_indicator_id('nuts3_code'), get_dataset_id('bkg_admin'), 'context_admin', 10),
(get_indicator_id('lau_code'), get_dataset_id('bkg_admin'), 'context_admin', 10),
(get_indicator_id('centroid_lat'), get_dataset_id('eurostat_geostat'), 'context_grid', 10),
(get_indicator_id('centroid_lon'), get_dataset_id('eurostat_geostat'), 'context_grid', 10);

-- Cleanup helper functions
DROP FUNCTION IF EXISTS get_indicator_id(text);
DROP FUNCTION IF EXISTS get_dataset_id(text);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these to verify the migration worked:
--
-- SELECT COUNT(*) AS dataset_count FROM public.datasets;
-- -- Expected: ~25 datasets
--
-- SELECT COUNT(*) AS indicator_count FROM public.indicators;
-- -- Expected: ~70 indicators
--
-- SELECT COUNT(*) AS mapping_count FROM public.indicator_datasets;
-- -- Expected: ~80 mappings
--
-- SELECT * FROM public.list_indicators('Klima', NULL);
-- -- Should return climate indicators
--
-- SELECT * FROM public.list_datasets('climate');
-- -- Should return climate datasets
--
-- SELECT * FROM public.get_indicator_sources(ARRAY['temp_mean_annual', 'population_total']);
-- -- Should return datasets for these indicators
-- ============================================
