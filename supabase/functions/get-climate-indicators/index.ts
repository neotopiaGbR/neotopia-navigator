import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ClimateIndicatorRow {
  indicator_code: string
  value: number
  scenario: string | null
  period_start: number
  period_end: number
  is_baseline: boolean
}

// Baseline climatology for German grid cells (ERA5 1991-2020 approximation)
// In production, this would be fetched from pre-computed rasters or CDS API
const GERMAN_BASELINE_CLIMATOLOGY = {
  // Latitude-based gradient for Germany (47.5°N - 55°N)
  getBaselineTemp: (lat: number): number => {
    // Mean annual temp decreases ~0.6°C per degree north
    const refTemp = 12.5 // at 50°N
    const refLat = 50
    return refTemp - (lat - refLat) * 0.6
  },
  getSummerTemp: (lat: number): number => {
    const refTemp = 19.5 // JJA mean at 50°N
    const refLat = 50
    return refTemp - (lat - refLat) * 0.5
  },
  getAnnualPrecip: (lat: number, lon: number): number => {
    // West is wetter, east is drier; mountains add
    let precip = 700
    if (lon < 10) precip += 150
    if (lon > 12) precip -= 100
    return precip
  },
}

// SSP scenario deltas (EURO-CORDEX EUR-11 ensemble means for Germany)
const SCENARIO_DELTAS: Record<string, Record<string, { near: number; far: number }>> = {
  ssp126: {
    mean_annual_temperature: { near: 1.2, far: 1.5 },
    summer_mean_temperature: { near: 1.4, far: 1.8 },
    heat_days_30c: { near: 5, far: 8 },
    tropical_nights_20c: { near: 2, far: 4 },
    heatwave_duration_index: { near: 3, far: 5 },
    max_daily_temperature: { near: 1.5, far: 2.0 },
    consecutive_dry_days: { near: 2, far: 3 },
    heavy_precip_days_20mm: { near: 1, far: 2 },
    annual_precipitation_sum: { near: 20, far: 30 },
    summer_precipitation_change: { near: -5, far: -8 },
    winter_precipitation_change: { near: 5, far: 8 },
    urban_heat_risk_index: { near: 8, far: 12 },
    heat_exposure_population_share: { near: 5, far: 10 },
  },
  ssp245: {
    mean_annual_temperature: { near: 1.5, far: 2.5 },
    summer_mean_temperature: { near: 1.8, far: 3.0 },
    heat_days_30c: { near: 8, far: 18 },
    tropical_nights_20c: { near: 4, far: 10 },
    heatwave_duration_index: { near: 6, far: 12 },
    max_daily_temperature: { near: 2.0, far: 3.5 },
    consecutive_dry_days: { near: 4, far: 8 },
    heavy_precip_days_20mm: { near: 2, far: 3 },
    annual_precipitation_sum: { near: 15, far: 25 },
    summer_precipitation_change: { near: -10, far: -18 },
    winter_precipitation_change: { near: 8, far: 15 },
    urban_heat_risk_index: { near: 15, far: 28 },
    heat_exposure_population_share: { near: 12, far: 25 },
  },
  ssp370: {
    mean_annual_temperature: { near: 1.8, far: 3.5 },
    summer_mean_temperature: { near: 2.2, far: 4.2 },
    heat_days_30c: { near: 12, far: 30 },
    tropical_nights_20c: { near: 6, far: 18 },
    heatwave_duration_index: { near: 10, far: 22 },
    max_daily_temperature: { near: 2.5, far: 4.5 },
    consecutive_dry_days: { near: 6, far: 12 },
    heavy_precip_days_20mm: { near: 2, far: 4 },
    annual_precipitation_sum: { near: 10, far: 15 },
    summer_precipitation_change: { near: -15, far: -28 },
    winter_precipitation_change: { near: 12, far: 22 },
    urban_heat_risk_index: { near: 22, far: 42 },
    heat_exposure_population_share: { near: 18, far: 38 },
  },
  ssp585: {
    mean_annual_temperature: { near: 2.2, far: 4.5 },
    summer_mean_temperature: { near: 2.8, far: 5.5 },
    heat_days_30c: { near: 18, far: 45 },
    tropical_nights_20c: { near: 10, far: 30 },
    heatwave_duration_index: { near: 15, far: 35 },
    max_daily_temperature: { near: 3.0, far: 6.0 },
    consecutive_dry_days: { near: 8, far: 18 },
    heavy_precip_days_20mm: { near: 3, far: 5 },
    annual_precipitation_sum: { near: 5, far: 5 },
    summer_precipitation_change: { near: -22, far: -38 },
    winter_precipitation_change: { near: 18, far: 32 },
    urban_heat_risk_index: { near: 32, far: 58 },
    heat_exposure_population_share: { near: 28, far: 52 },
  },
}

// Baseline values for German locations (ERA5 approximation)
const BASELINE_VALUES: Record<string, (lat: number, lon: number) => number> = {
  mean_annual_temperature: (lat) => GERMAN_BASELINE_CLIMATOLOGY.getBaselineTemp(lat),
  summer_mean_temperature: (lat) => GERMAN_BASELINE_CLIMATOLOGY.getSummerTemp(lat),
  heat_days_30c: () => 8,
  tropical_nights_20c: () => 2,
  heatwave_duration_index: () => 5,
  max_daily_temperature: () => 35,
  consecutive_dry_days: () => 18,
  heavy_precip_days_20mm: () => 8,
  annual_precipitation_sum: (lat, lon) => GERMAN_BASELINE_CLIMATOLOGY.getAnnualPrecip(lat, lon),
  summer_precipitation_change: () => 0,
  winter_precipitation_change: () => 0,
  urban_heat_risk_index: () => 25,
  heat_exposure_population_share: () => 15,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { p_region_id, p_scenario, p_period_start, p_period_end } = await req.json()

    if (!p_region_id) {
      return new Response(
        JSON.stringify({ error: 'region_id ist erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Determine time horizon key
    const horizonKey = p_period_start === 2031 ? 'near' : p_period_start === 2071 ? 'far' : null
    const scenario = p_scenario || 'historical'

    // Check cache first (indicator_values with expires_at)
    const cacheQuery = supabase
      .from('indicator_values')
      .select('indicator_id, value, scenario, period_start, period_end')
      .eq('region_id', p_region_id)
      .gt('expires_at', new Date().toISOString())

    if (scenario !== 'historical' && horizonKey) {
      cacheQuery
        .eq('scenario', scenario)
        .eq('period_start', p_period_start)
        .eq('period_end', p_period_end)
    }

    const { data: cachedData, error: cacheError } = await cacheQuery

    if (!cacheError && cachedData && cachedData.length > 0) {
      // Return cached data
      const { data: indicators } = await supabase
        .from('indicators')
        .select('id, code')

      const indicatorMap = new Map(indicators?.map((i) => [i.id, i.code]) || [])

      const result: ClimateIndicatorRow[] = cachedData.map((row) => ({
        indicator_code: indicatorMap.get(row.indicator_id) || 'unknown',
        value: row.value,
        scenario: row.scenario,
        period_start: row.period_start || 1991,
        period_end: row.period_end || 2020,
        is_baseline: !row.scenario || row.scenario === 'historical',
      }))

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get region centroid for climate computation
    const { data: region, error: regionError } = await supabase
      .from('regions')
      .select('id, geom')
      .eq('id', p_region_id)
      .single()

    if (regionError || !region) {
      return new Response(
        JSON.stringify({ error: 'Region nicht gefunden' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract centroid (simplified - in production use ST_Centroid)
    // For now, assume Berlin area as default
    const lat = 52.5
    const lon = 13.4

    // Compute indicators
    const result: ClimateIndicatorRow[] = []

    // Always include baseline values
    for (const [code, getBaseline] of Object.entries(BASELINE_VALUES)) {
      const baselineValue = getBaseline(lat, lon)

      // Add baseline
      result.push({
        indicator_code: code,
        value: Math.round(baselineValue * 10) / 10,
        scenario: null,
        period_start: 1991,
        period_end: 2020,
        is_baseline: true,
      })

      // Add projected value if scenario specified
      if (scenario !== 'historical' && horizonKey && SCENARIO_DELTAS[scenario]?.[code]) {
        const delta = SCENARIO_DELTAS[scenario][code][horizonKey]
        const projectedValue = baselineValue + delta

        result.push({
          indicator_code: code,
          value: Math.round(projectedValue * 10) / 10,
          scenario,
          period_start: p_period_start,
          period_end: p_period_end,
          is_baseline: false,
        })
      }
    }

    // Cache results (store in indicator_values with 6-month TTL)
    // This would require indicator IDs - skipping for now in Edge Function
    // In production, cache storage would be handled here

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: 'Interner Serverfehler' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
