-- Heat Indicators Migration
-- Adds 4 heat indicators to public.indicators table
-- Run this migration to ensure indicator registry contains all heat indicators

-- Insert heat indicators (idempotent - uses ON CONFLICT)
INSERT INTO public.indicators (
  code, 
  name, 
  description, 
  unit, 
  domain, 
  topic,
  category,
  direction,
  format,
  precision,
  value_type,
  temporal_type,
  requires_scenario,
  requires_period,
  default_ttl_days
)
VALUES
  (
    'summer_days_25c',
    'Sommertage (≥25°C)',
    'Anzahl der Tage pro Jahr mit einer Tageshöchsttemperatur von mindestens 25°C',
    'days/year',
    'Klima',
    'Hitze',
    'heat',
    'higher_is_worse',
    'number',
    1,
    'number',
    'scenario',
    true,
    true,
    180
  ),
  (
    'hot_days_30c',
    'Heiße Tage (≥30°C)',
    'Anzahl der Tage pro Jahr mit einer Tageshöchsttemperatur von mindestens 30°C',
    'days/year',
    'Klima',
    'Hitze',
    'heat',
    'higher_is_worse',
    'number',
    1,
    'number',
    'scenario',
    true,
    true,
    180
  ),
  (
    'tropical_nights_20c',
    'Tropennächte (≥20°C)',
    'Anzahl der Nächte pro Jahr mit einer Minimaltemperatur von mindestens 20°C',
    'nights/year',
    'Klima',
    'Hitze',
    'heat',
    'higher_is_worse',
    'number',
    1,
    'number',
    'scenario',
    true,
    true,
    180
  ),
  (
    'heat_wave_days',
    'Hitzewellentage',
    'Anzahl der Tage pro Jahr, die Teil einer Hitzewelle sind (mindestens 3 aufeinanderfolgende Tage mit Tmax ≥ 30°C)',
    'days/year',
    'Klima',
    'Hitze',
    'heat',
    'higher_is_worse',
    'number',
    1,
    'number',
    'scenario',
    true,
    true,
    180
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  domain = EXCLUDED.domain,
  topic = EXCLUDED.topic,
  category = EXCLUDED.category,
  direction = EXCLUDED.direction,
  format = EXCLUDED.format,
  precision = EXCLUDED.precision,
  value_type = EXCLUDED.value_type,
  temporal_type = EXCLUDED.temporal_type,
  requires_scenario = EXCLUDED.requires_scenario,
  requires_period = EXCLUDED.requires_period,
  default_ttl_days = EXCLUDED.default_ttl_days;

-- Verification query (run after migration)
-- SELECT code, name, unit, domain, topic, requires_scenario, requires_period 
-- FROM public.indicators 
-- WHERE code IN ('summer_days_25c', 'hot_days_30c', 'tropical_nights_20c', 'heat_wave_days');
