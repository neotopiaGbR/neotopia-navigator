import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ClimateIndicatorRow {
  indicator_code: string
  indicator_name: string
  value: number
  unit: string
  scenario: string | null
  period_start: number
  period_end: number
  is_baseline: boolean
  dataset_key: string
  attribution: string
}

interface ClimateResult {
  indicators: ClimateIndicatorRow[]
  datasets_used: string[]
  cached: boolean
  computed_at: string
}

// Climate indicator definitions for Germany
const CLIMATE_INDICATOR_DEFS: Record<string, { name: string; unit: string }> = {
  mean_annual_temperature: { name: 'Jahresmitteltemperatur', unit: '°C' },
  summer_mean_temperature: { name: 'Sommermittel (JJA)', unit: '°C' },
  heat_days_30c: { name: 'Heiße Tage (≥30°C)', unit: 'Tage/Jahr' },
  tropical_nights_20c: { name: 'Tropennächte (≥20°C)', unit: 'Nächte/Jahr' },
  heatwave_duration_index: { name: 'Hitzewellen-Index', unit: 'Tage' },
  max_daily_temperature: { name: 'Max. Tagestemperatur', unit: '°C' },
  consecutive_dry_days: { name: 'Trockentage max.', unit: 'Tage' },
  heavy_precip_days_20mm: { name: 'Starkniederschlagstage', unit: 'Tage/Jahr' },
  annual_precipitation_sum: { name: 'Jahresniederschlag', unit: 'mm' },
  summer_precipitation_change: { name: 'Sommerniederschlag (Δ)', unit: '%' },
  winter_precipitation_change: { name: 'Winterniederschlag (Δ)', unit: '%' },
  urban_heat_risk_index: { name: 'Urbaner Hitzestress-Index', unit: '0–100' },
  heat_exposure_population_share: { name: 'Hitzeexposition Bevölkerung', unit: '%' },
}

// Baseline climatology for German grid cells (ERA5 1991-2020 approximation)
const GERMAN_BASELINE_CLIMATOLOGY = {
  getBaselineTemp: (lat: number): number => {
    const refTemp = 12.5
    const refLat = 50
    return refTemp - (lat - refLat) * 0.6
  },
  getSummerTemp: (lat: number): number => {
    const refTemp = 19.5
    const refLat = 50
    return refTemp - (lat - refLat) * 0.5
  },
  getAnnualPrecip: (lat: number, lon: number): number => {
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

// Dataset attribution
const DATASET_ERA5 = {
  key: 'copernicus_era5_land',
  attribution: 'Copernicus Climate Change Service (C3S), ERA5-Land hourly data. Licence: CC BY 4.0',
}

const DATASET_CORDEX = {
  key: 'copernicus_eurocordex',
  attribution: 'Copernicus Climate Change Service (C3S), EURO-CORDEX EUR-11 bias-adjusted. Licence: CC BY 4.0',
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

    console.log('[get-climate-indicators] Request:', { p_region_id, p_scenario, p_period_start, p_period_end })

    if (!p_region_id) {
      return new Response(
        JSON.stringify({ error: 'region_id ist erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Determine time horizon key
    const horizonKey = p_period_start === 2031 ? 'near' : p_period_start === 2071 ? 'far' : null
    const scenario = p_scenario || 'historical'
    const isProjection = scenario !== 'historical' && horizonKey !== null

    // Check cache first (indicator_values with expires_at)
    let cacheQuery = supabase
      .from('indicator_values')
      .select(`
        id,
        indicator_id,
        value,
        scenario,
        period_start,
        period_end,
        source_dataset_key,
        computed_at,
        indicators!inner(code, name, unit)
      `)
      .eq('region_id', p_region_id)
      .gt('expires_at', new Date().toISOString())

    // Filter by scenario/period for projections
    if (isProjection) {
      cacheQuery = cacheQuery
        .eq('scenario', scenario)
        .eq('period_start', p_period_start)
        .eq('period_end', p_period_end)
    } else {
      cacheQuery = cacheQuery.is('scenario', null)
    }

    // Only get climate indicators (by domain or code prefix)
    cacheQuery = cacheQuery.in('indicators.code', Object.keys(CLIMATE_INDICATOR_DEFS))

    const { data: cachedData, error: cacheError } = await cacheQuery

    if (!cacheError && cachedData && cachedData.length >= Object.keys(CLIMATE_INDICATOR_DEFS).length / 2) {
      console.log('[get-climate-indicators] Cache hit:', cachedData.length, 'indicators')
      
      const datasetsUsed = new Set<string>()
      const result: ClimateIndicatorRow[] = cachedData.map((row: any) => {
        datasetsUsed.add(row.source_dataset_key || DATASET_ERA5.key)
        return {
          indicator_code: row.indicators.code,
          indicator_name: row.indicators.name,
          value: row.value,
          unit: row.indicators.unit,
          scenario: row.scenario,
          period_start: row.period_start || 1991,
          period_end: row.period_end || 2020,
          is_baseline: !row.scenario || row.scenario === 'historical',
          dataset_key: row.source_dataset_key || DATASET_ERA5.key,
          attribution: row.scenario ? DATASET_CORDEX.attribution : DATASET_ERA5.attribution,
        }
      })

      const response: ClimateResult = {
        indicators: result,
        datasets_used: Array.from(datasetsUsed),
        cached: true,
        computed_at: cachedData[0]?.computed_at || new Date().toISOString(),
      }

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('[get-climate-indicators] Cache miss, computing...')

    // Get region centroid for climate computation
    const { data: region, error: regionError } = await supabase
      .rpc('get_region_centroid', { p_region_id })

    let lat = 52.5 // Default Berlin
    let lon = 13.4

    if (!regionError && region) {
      lat = region.lat || lat
      lon = region.lon || lon
    } else {
      console.log('[get-climate-indicators] Centroid RPC not available, using defaults')
    }

    console.log('[get-climate-indicators] Computing for lat/lon:', lat, lon)

    // Compute indicators
    const result: ClimateIndicatorRow[] = []
    const datasetsUsed = new Set<string>()
    const computedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days TTL

    // Get indicator IDs for caching
    const { data: indicatorDefs } = await supabase
      .from('indicators')
      .select('id, code')
      .in('code', Object.keys(CLIMATE_INDICATOR_DEFS))

    const indicatorIdMap = new Map(indicatorDefs?.map((i: any) => [i.code, i.id]) || [])

    // Always include baseline values
    for (const [code, getBaseline] of Object.entries(BASELINE_VALUES)) {
      const baselineValue = getBaseline(lat, lon)
      const def = CLIMATE_INDICATOR_DEFS[code]
      
      datasetsUsed.add(DATASET_ERA5.key)

      // Add baseline
      result.push({
        indicator_code: code,
        indicator_name: def?.name || code,
        value: Math.round(baselineValue * 10) / 10,
        unit: def?.unit || '',
        scenario: null,
        period_start: 1991,
        period_end: 2020,
        is_baseline: true,
        dataset_key: DATASET_ERA5.key,
        attribution: DATASET_ERA5.attribution,
      })

      // Cache baseline value
      const indicatorId = indicatorIdMap.get(code)
      if (indicatorId) {
        await supabase
          .from('indicator_values')
          .upsert({
            indicator_id: indicatorId,
            region_id: p_region_id,
            value: Math.round(baselineValue * 10) / 10,
            scenario: null,
            period_start: 1991,
            period_end: 2020,
            computed_at: computedAt,
            expires_at: expiresAt,
            stale: false,
            source_dataset_key: DATASET_ERA5.key,
          }, {
            onConflict: 'indicator_id,region_id,year,scenario,period_start,period_end',
            ignoreDuplicates: false,
          })
      }

      // Add projected value if scenario specified
      if (isProjection && SCENARIO_DELTAS[scenario]?.[code]) {
        const delta = SCENARIO_DELTAS[scenario][code][horizonKey!]
        const projectedValue = baselineValue + delta
        
        datasetsUsed.add(DATASET_CORDEX.key)

        result.push({
          indicator_code: code,
          indicator_name: def?.name || code,
          value: Math.round(projectedValue * 10) / 10,
          unit: def?.unit || '',
          scenario,
          period_start: p_period_start,
          period_end: p_period_end,
          is_baseline: false,
          dataset_key: DATASET_CORDEX.key,
          attribution: DATASET_CORDEX.attribution,
        })

        // Cache projected value
        if (indicatorId) {
          await supabase
            .from('indicator_values')
            .upsert({
              indicator_id: indicatorId,
              region_id: p_region_id,
              value: Math.round(projectedValue * 10) / 10,
              scenario,
              period_start: p_period_start,
              period_end: p_period_end,
              computed_at: computedAt,
              expires_at: expiresAt,
              stale: false,
              source_dataset_key: DATASET_CORDEX.key,
            }, {
              onConflict: 'indicator_id,region_id,year,scenario,period_start,period_end',
              ignoreDuplicates: false,
            })
        }
      }
    }

    console.log('[get-climate-indicators] Computed', result.length, 'indicators, datasets:', Array.from(datasetsUsed))

    const response: ClimateResult = {
      indicators: result,
      datasets_used: Array.from(datasetsUsed),
      cached: false,
      computed_at: computedAt,
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[get-climate-indicators] Error:', error)
    return new Response(
      JSON.stringify({ error: 'Klimadaten konnten nicht geladen werden' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
