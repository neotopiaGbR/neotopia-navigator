-- Migration: Register Thermal Stress & Energy Indicators (#9-#12)
-- Run this in Supabase Dashboard > SQL Editor

-- #9 UTCI Mean Summer
INSERT INTO public.indicators (
  code,
  name,
  description,
  unit,
  domain,
  value_type,
  temporal_type,
  requires_scenario,
  requires_period,
  direction,
  default_ttl_days
) VALUES (
  'utci_mean_summer',
  'UTCI Sommer (Mittel)',
  'Universal Thermal Climate Index – Sommermittel (Juni–August). Repräsentiert thermischen Stress für den Menschen.',
  '°C',
  'klima',
  'number',
  'scenario',
  true,
  true,
  'lower_is_better',
  180
) ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  domain = EXCLUDED.domain,
  value_type = EXCLUDED.value_type,
  temporal_type = EXCLUDED.temporal_type,
  requires_scenario = EXCLUDED.requires_scenario,
  requires_period = EXCLUDED.requires_period,
  direction = EXCLUDED.direction,
  default_ttl_days = EXCLUDED.default_ttl_days;

-- #10 PET Mean Summer
INSERT INTO public.indicators (
  code,
  name,
  description,
  unit,
  domain,
  value_type,
  temporal_type,
  requires_scenario,
  requires_period,
  direction,
  default_ttl_days
) VALUES (
  'pet_mean_summer',
  'PET Sommer (Mittel)',
  'Physiologically Equivalent Temperature – Sommermittel (Juni–August). Standardindex für thermischen Komfort in der Stadtplanung.',
  '°C',
  'klima',
  'number',
  'scenario',
  true,
  true,
  'lower_is_better',
  180
) ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  domain = EXCLUDED.domain,
  value_type = EXCLUDED.value_type,
  temporal_type = EXCLUDED.temporal_type,
  requires_scenario = EXCLUDED.requires_scenario,
  requires_period = EXCLUDED.requires_period,
  direction = EXCLUDED.direction,
  default_ttl_days = EXCLUDED.default_ttl_days;

-- #11 Cooling Degree Days
INSERT INTO public.indicators (
  code,
  name,
  description,
  unit,
  domain,
  value_type,
  temporal_type,
  requires_scenario,
  requires_period,
  direction,
  default_ttl_days
) VALUES (
  'cooling_degree_days',
  'Kühlgradtage (CDD)',
  'Cooling Degree Days – Summe der Tage mit Tagesmittel > 18°C × Differenz zu 18°C. Indikator für Kühlbedarf.',
  '°C·d/Jahr',
  'klima',
  'number',
  'scenario',
  true,
  true,
  'lower_is_better',
  180
) ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  domain = EXCLUDED.domain,
  value_type = EXCLUDED.value_type,
  temporal_type = EXCLUDED.temporal_type,
  requires_scenario = EXCLUDED.requires_scenario,
  requires_period = EXCLUDED.requires_period,
  direction = EXCLUDED.direction,
  default_ttl_days = EXCLUDED.default_ttl_days;

-- #12 Heating Degree Days
INSERT INTO public.indicators (
  code,
  name,
  description,
  unit,
  domain,
  value_type,
  temporal_type,
  requires_scenario,
  requires_period,
  direction,
  default_ttl_days
) VALUES (
  'heating_degree_days',
  'Heizgradtage (HDD)',
  'Heating Degree Days – Summe der Tage mit Tagesmittel < 15°C × Differenz zu 15°C. Indikator für Heizbedarf.',
  '°C·d/Jahr',
  'klima',
  'number',
  'scenario',
  true,
  true,
  'higher_is_better',
  180
) ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  domain = EXCLUDED.domain,
  value_type = EXCLUDED.value_type,
  temporal_type = EXCLUDED.temporal_type,
  requires_scenario = EXCLUDED.requires_scenario,
  requires_period = EXCLUDED.requires_period,
  direction = EXCLUDED.direction,
  default_ttl_days = EXCLUDED.default_ttl_days;

-- Verify
SELECT code, name, unit, requires_scenario, requires_period 
FROM public.indicators 
WHERE code IN ('utci_mean_summer', 'pet_mean_summer', 'cooling_degree_days', 'heating_degree_days')
ORDER BY code;
