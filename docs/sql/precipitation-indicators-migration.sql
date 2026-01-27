-- Migration: Add precipitation indicators (#6-#8)
-- Run this in Cloud View > Run SQL

-- Insert new precipitation indicators (skip if already exists)
INSERT INTO public.indicators (
  code,
  name,
  description,
  unit,
  value_type,
  temporal_type,
  domain,
  topic,
  direction,
  requires_scenario,
  requires_period,
  default_ttl_days
)
SELECT * FROM (VALUES
  (
    'precip_annual',
    'Jahresniederschlag',
    'Mittlerer Gesamtniederschlag pro Jahr',
    'mm/year',
    'number',
    'scenario',
    'climate',
    'precipitation',
    'neutral',
    true,
    true,
    180
  ),
  (
    'precip_intense_20mm',
    'Starkniederschlagstage (≥20mm)',
    'Mittlere Anzahl Tage pro Jahr mit Niederschlag ≥ 20mm',
    'days/year',
    'number',
    'scenario',
    'climate',
    'precipitation',
    'down',
    true,
    true,
    180
  ),
  (
    'dry_days_consecutive',
    'Max. aufeinanderfolgende Trockentage',
    'Mittlere maximale Anzahl aufeinanderfolgender Tage mit < 1mm Niederschlag pro Jahr',
    'days',
    'number',
    'scenario',
    'climate',
    'drought',
    'down',
    true,
    true,
    180
  )
) AS v(code, name, description, unit, value_type, temporal_type, domain, topic, direction, requires_scenario, requires_period, default_ttl_days)
WHERE NOT EXISTS (
  SELECT 1 FROM public.indicators WHERE indicators.code = v.code
);

-- Verify insertion
SELECT code, name, unit, domain, topic FROM public.indicators 
WHERE code IN ('precip_annual', 'precip_intense_20mm', 'dry_days_consecutive');
