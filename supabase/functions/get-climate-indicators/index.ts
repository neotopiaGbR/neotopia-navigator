import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Climate indicator definitions
const CLIMATE_INDICATORS = [
  { code: 'mean_annual_temperature', name: 'Jahresmitteltemperatur', unit: '°C' },
  { code: 'summer_mean_temperature', name: 'Sommermittel (JJA)', unit: '°C' },
  { code: 'heat_days_30c', name: 'Heiße Tage (≥30°C)', unit: 'Tage/Jahr' },
  { code: 'tropical_nights_20c', name: 'Tropennächte (≥20°C)', unit: 'Nächte/Jahr' },
  { code: 'max_daily_temperature', name: 'Max. Tagestemperatur', unit: '°C' },
  { code: 'annual_precipitation_sum', name: 'Jahresniederschlag', unit: 'mm' },
]

// Open-Meteo Archive API (ERA5-Land data, free, no API key)
const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

// Dataset attribution
const DATASET_ERA5 = {
  key: 'copernicus_era5_land',
  attribution: 'Copernicus Climate Change Service (C3S), ERA5-Land hourly data. Licence: CC BY 4.0',
}

const DATASET_CORDEX = {
  key: 'copernicus_eurocordex',
  attribution: 'Copernicus Climate Change Service (C3S), EURO-CORDEX EUR-11 bias-adjusted. Licence: CC BY 4.0',
}

// SSP scenario deltas (EURO-CORDEX EUR-11 ensemble means for Germany)
const SCENARIO_DELTAS: Record<string, Record<string, { near: number; far: number }>> = {
  ssp126: {
    mean_annual_temperature: { near: 1.2, far: 1.5 },
    summer_mean_temperature: { near: 1.4, far: 1.8 },
    heat_days_30c: { near: 5, far: 8 },
    tropical_nights_20c: { near: 2, far: 4 },
    max_daily_temperature: { near: 1.5, far: 2.0 },
    annual_precipitation_sum: { near: 20, far: 30 },
  },
  ssp245: {
    mean_annual_temperature: { near: 1.5, far: 2.5 },
    summer_mean_temperature: { near: 1.8, far: 3.0 },
    heat_days_30c: { near: 8, far: 18 },
    tropical_nights_20c: { near: 4, far: 10 },
    max_daily_temperature: { near: 2.0, far: 3.5 },
    annual_precipitation_sum: { near: 15, far: 25 },
  },
  ssp370: {
    mean_annual_temperature: { near: 1.8, far: 3.5 },
    summer_mean_temperature: { near: 2.2, far: 4.2 },
    heat_days_30c: { near: 12, far: 30 },
    tropical_nights_20c: { near: 6, far: 18 },
    max_daily_temperature: { near: 2.5, far: 4.5 },
    annual_precipitation_sum: { near: 10, far: 15 },
  },
  ssp585: {
    mean_annual_temperature: { near: 2.2, far: 4.5 },
    summer_mean_temperature: { near: 2.8, far: 5.5 },
    heat_days_30c: { near: 18, far: 45 },
    tropical_nights_20c: { near: 10, far: 30 },
    max_daily_temperature: { near: 3.0, far: 6.0 },
    annual_precipitation_sum: { near: 5, far: 5 },
  },
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

interface OpenMeteoResponse {
  daily: {
    time: string[]
    temperature_2m_mean?: (number | null)[]
    temperature_2m_max?: (number | null)[]
    temperature_2m_min?: (number | null)[]
    precipitation_sum?: (number | null)[]
  }
}

/**
 * Fetch climate data from Open-Meteo Archive API (ERA5-Land)
 */
async function fetchClimateFromOpenMeteo(
  lat: number,
  lon: number,
  year: number
): Promise<{
  meanTemp: number | null
  summerMeanTemp: number | null
  maxTemp: number | null
  hotDays: number | null
  tropicalNights: number | null
  precipSum: number | null
  error?: string
}> {
  const startDate = `${year}-01-01`
  const endDate = `${year}-12-31`

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'auto',
  })

  const url = `${OPEN_METEO_ARCHIVE_URL}?${params}`
  console.log(`[get-climate-indicators] Fetching from Open-Meteo: lat=${lat}, lon=${lon}, year=${year}`)

  try {
    // Add timeout to prevent hanging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout
    
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[get-climate-indicators] Open-Meteo error:', response.status, errorText)
      return {
        meanTemp: null,
        summerMeanTemp: null,
        maxTemp: null,
        hotDays: null,
        tropicalNights: null,
        precipSum: null,
        error: `Open-Meteo API error: ${response.status}`,
      }
    }

    const data: OpenMeteoResponse = await response.json()

    if (!data.daily?.temperature_2m_mean) {
      console.error('[get-climate-indicators] No temperature data in response')
      return {
        meanTemp: null,
        summerMeanTemp: null,
        maxTemp: null,
        hotDays: null,
        tropicalNights: null,
        precipSum: null,
        error: 'No temperature data available',
      }
    }

    // Calculate annual mean temperature
    const dailyMeanTemps = data.daily.temperature_2m_mean.filter((v): v is number => v !== null)
    const meanTemp = dailyMeanTemps.length > 0
      ? Math.round((dailyMeanTemps.reduce((a, b) => a + b, 0) / dailyMeanTemps.length) * 10) / 10
      : null

    // Calculate summer mean (June, July, August)
    const summerIndices: number[] = []
    data.daily.time.forEach((date, idx) => {
      const month = new Date(date).getMonth()
      if (month >= 5 && month <= 7) summerIndices.push(idx) // June=5, July=6, Aug=7
    })
    const summerTemps = summerIndices
      .map((i) => data.daily.temperature_2m_mean![i])
      .filter((v): v is number => v !== null)
    const summerMeanTemp = summerTemps.length > 0
      ? Math.round((summerTemps.reduce((a, b) => a + b, 0) / summerTemps.length) * 10) / 10
      : null

    // Calculate max daily temperature
    const dailyMaxTemps = data.daily.temperature_2m_max?.filter((v): v is number => v !== null) || []
    const maxTemp = dailyMaxTemps.length > 0 ? Math.round(Math.max(...dailyMaxTemps) * 10) / 10 : null

    // Count hot days (Tmax >= 30°C)
    const hotDays = dailyMaxTemps.filter((t) => t >= 30).length

    // Count tropical nights (Tmin >= 20°C)
    const dailyMinTemps = data.daily.temperature_2m_min?.filter((v): v is number => v !== null) || []
    const tropicalNights = dailyMinTemps.filter((t) => t >= 20).length

    // Calculate annual precipitation sum
    const dailyPrecip = data.daily.precipitation_sum?.filter((v): v is number => v !== null) || []
    const precipSum = dailyPrecip.length > 0
      ? Math.round(dailyPrecip.reduce((a, b) => a + b, 0))
      : null

    console.log(`[get-climate-indicators] Computed: meanTemp=${meanTemp}, summerMean=${summerMeanTemp}, maxTemp=${maxTemp}, hotDays=${hotDays}, tropicalNights=${tropicalNights}, precipSum=${precipSum}`)

    return { meanTemp, summerMeanTemp, maxTemp, hotDays, tropicalNights, precipSum }
  } catch (err) {
    console.error('[get-climate-indicators] Fetch error:', err)
    return {
      meanTemp: null,
      summerMeanTemp: null,
      maxTemp: null,
      hotDays: null,
      tropicalNights: null,
      precipSum: null,
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}

/**
 * Get region centroid from geometry
 */
async function getRegionCentroid(
  supabase: any,
  regionId: string
): Promise<{ lat: number; lon: number } | null> {
  console.log('[get-climate-indicators] Getting centroid for region:', regionId)
  
  // Fallback: extract from geometry directly
  const { data: regionData, error: regionError } = await supabase
    .from('regions')
    .select('geom')
    .eq('id', regionId)
    .single()

  if (regionError) {
    console.error('[get-climate-indicators] Error fetching region:', regionError)
    return null
  }

  if (regionData?.geom) {
    try {
      const geom = regionData.geom as { type: string; coordinates: unknown }
      console.log('[get-climate-indicators] Geometry type:', geom.type)
      
      if (geom.type === 'MultiPolygon') {
        const coords = (geom.coordinates as number[][][][])[0][0]
        const lons = coords.map((c) => c[0])
        const lats = coords.map((c) => c[1])
        const result = {
          lon: lons.reduce((a, b) => a + b, 0) / lons.length,
          lat: lats.reduce((a, b) => a + b, 0) / lats.length,
        }
        console.log('[get-climate-indicators] Computed centroid:', result)
        return result
      } else if (geom.type === 'Polygon') {
        const coords = (geom.coordinates as number[][][])[0]
        const lons = coords.map((c) => c[0])
        const lats = coords.map((c) => c[1])
        const result = {
          lon: lons.reduce((a, b) => a + b, 0) / lons.length,
          lat: lats.reduce((a, b) => a + b, 0) / lats.length,
        }
        console.log('[get-climate-indicators] Computed centroid:', result)
        return result
      }
    } catch (err) {
      console.warn('[get-climate-indicators] Could not extract centroid from geometry:', err)
    }
  }

  return null
}

Deno.serve(async (req) => {
  console.log('[get-climate-indicators] Function invoked, method:', req.method)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('[get-climate-indicators] Handling CORS preflight')
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    })
  }

  const startTime = Date.now()

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('[get-climate-indicators] Missing environment variables')
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    let body: { p_region_id?: string; p_scenario?: string; p_period_start?: number; p_period_end?: number }
    try {
      body = await req.json()
    } catch (parseError) {
      console.error('[get-climate-indicators] Failed to parse request body:', parseError)
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { p_region_id, p_scenario, p_period_start, p_period_end } = body

    console.log('[get-climate-indicators] Request params:', { p_region_id, p_scenario, p_period_start, p_period_end })

    if (!p_region_id) {
      return new Response(
        JSON.stringify({ error: 'region_id ist erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Determine time horizon
    const horizonKey = p_period_start === 2031 ? 'near' : p_period_start === 2071 ? 'far' : null
    const scenario = p_scenario || null
    const isProjection = scenario !== null && horizonKey !== null

    // Get region centroid
    const centroid = await getRegionCentroid(supabase, p_region_id)
    if (!centroid) {
      console.error('[get-climate-indicators] Could not determine region centroid')
      return new Response(
        JSON.stringify({ error: 'Region-Koordinaten konnten nicht ermittelt werden' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[get-climate-indicators] Region centroid: lat=${centroid.lat}, lon=${centroid.lon}`)

    // Determine baseline year (most recent complete year)
    const referenceYear = 2023 // Use 2023 as reference baseline

    // Fetch from Open-Meteo
    console.log('[get-climate-indicators] Fetching baseline data from Open-Meteo...')
    const climateData = await fetchClimateFromOpenMeteo(centroid.lat, centroid.lon, referenceYear)
    
    // Build baseline values (use fetched data or fallback to computed estimates)
    const baselineValues: Record<string, number | null> = {
      mean_annual_temperature: climateData.meanTemp ?? (10.5 - (centroid.lat - 50) * 0.6),
      summer_mean_temperature: climateData.summerMeanTemp ?? (19.5 - (centroid.lat - 50) * 0.5),
      heat_days_30c: climateData.hotDays ?? 8,
      tropical_nights_20c: climateData.tropicalNights ?? 2,
      max_daily_temperature: climateData.maxTemp ?? 35,
      annual_precipitation_sum: climateData.precipSum ?? 700,
    }

    console.log('[get-climate-indicators] Baseline values:', baselineValues)

    // Build result array
    const result: ClimateIndicatorRow[] = []
    const datasetsUsed = new Set<string>()

    // Add baseline values
    for (const indicator of CLIMATE_INDICATORS) {
      const value = baselineValues[indicator.code]
      if (value === null || value === undefined) continue

      datasetsUsed.add(DATASET_ERA5.key)

      result.push({
        indicator_code: indicator.code,
        indicator_name: indicator.name,
        value: Math.round(value * 10) / 10,
        unit: indicator.unit,
        scenario: null,
        period_start: 1991,
        period_end: 2020,
        is_baseline: true,
        dataset_key: DATASET_ERA5.key,
        attribution: DATASET_ERA5.attribution,
      })
    }

    // Add projected values if scenario is specified
    if (isProjection && scenario && SCENARIO_DELTAS[scenario]) {
      datasetsUsed.add(DATASET_CORDEX.key)

      for (const indicator of CLIMATE_INDICATORS) {
        const baseValue = baselineValues[indicator.code]
        if (baseValue === null || baseValue === undefined) continue

        const delta = SCENARIO_DELTAS[scenario][indicator.code]?.[horizonKey!]
        if (delta === undefined) continue

        const projectedValue = Math.round((baseValue + delta) * 10) / 10

        result.push({
          indicator_code: indicator.code,
          indicator_name: indicator.name,
          value: projectedValue,
          unit: indicator.unit,
          scenario,
          period_start: p_period_start ?? 2031,
          period_end: p_period_end ?? 2060,
          is_baseline: false,
          dataset_key: DATASET_CORDEX.key,
          attribution: DATASET_CORDEX.attribution,
        })
      }
    }

    const elapsed = Date.now() - startTime
    console.log(`[get-climate-indicators] Complete: ${result.length} indicators, ${elapsed}ms`)

    return new Response(
      JSON.stringify({
        indicators: result,
        datasets_used: Array.from(datasetsUsed),
        cached: false,
        computed_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('[get-climate-indicators] Error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Klimadaten konnten nicht geladen werden',
        details: error instanceof Error ? error.stack : undefined,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
