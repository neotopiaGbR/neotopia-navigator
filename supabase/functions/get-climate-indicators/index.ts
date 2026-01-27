import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// We only guarantee one real indicator end-to-end right now.
// Do NOT change indicator definitions in the DB; this function uses the registry via indicators.code.
const DEFAULT_INDICATOR_CODES = ['temp_mean_annual']

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

type IndicatorMetaRow = {
  id: string
  code: string
  unit: string | null
  default_ttl_days: number | null
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
    .maybeSingle()

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

async function fetchAnnualMeanTempC(
  lat: number,
  lon: number,
  year: number
): Promise<{ value: number; dailyCount: number } | { error: string }> {
  const startDate = `${year}-01-01`
  const endDate = `${year}-12-31`

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_mean',
    timezone: 'auto',
  })

  const url = `${OPEN_METEO_ARCHIVE_URL}?${params}`
  console.log(`[get-climate-indicators] Open-Meteo request: ${url}`)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[get-climate-indicators] Open-Meteo error:', response.status, errorText)
      return { error: `Open-Meteo API error: ${response.status}` }
    }

    const data: OpenMeteoResponse = await response.json()
    const daily = data.daily?.temperature_2m_mean
    if (!daily) return { error: 'Open-Meteo response missing daily temperature_2m_mean' }

    const readings = daily.filter((v): v is number => v !== null)
    if (readings.length < 300) {
      return { error: `Insufficient daily readings (${readings.length}) for year ${year}` }
    }

    const mean = readings.reduce((a, b) => a + b, 0) / readings.length
    const rounded = Math.round(mean * 10) / 10
    console.log(`[get-climate-indicators] Annual mean computed: ${rounded}°C from ${readings.length} days`)
    return { value: rounded, dailyCount: readings.length }
  } catch (err) {
    console.error('[get-climate-indicators] Open-Meteo fetch failed:', err)
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
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

    let body: {
      // new contract
      region_id?: string
      indicator_codes?: string[]
      year?: number
      // backwards compatibility
      p_region_id?: string
      p_scenario?: string
      p_period_start?: number
      p_period_end?: number
    }
    try {
      body = await req.json()
    } catch (parseError) {
      console.error('[get-climate-indicators] Failed to parse request body:', parseError)
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const p_region_id = body.region_id ?? body.p_region_id
    const indicatorCodes = Array.isArray(body.indicator_codes) && body.indicator_codes.length > 0
      ? body.indicator_codes
      : DEFAULT_INDICATOR_CODES
    const requestYear = typeof body.year === 'number' ? body.year : new Date().getUTCFullYear() - 1

    console.log('[get-climate-indicators] Request params:', {
      region_id: p_region_id,
      indicator_codes: indicatorCodes,
      year: requestYear,
    })

    if (!p_region_id) {
      return new Response(
        JSON.stringify({ error: 'region_id ist erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get region centroid
    const centroid = await getRegionCentroid(supabase, p_region_id)
    if (!centroid) {
      console.error('[get-climate-indicators] Could not determine region centroid')
      return new Response(
        JSON.stringify({ error: 'Region-Koordinaten konnten nicht ermittelt werden' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[get-climate-indicators] Resolved centroid: lat=${centroid.lat}, lon=${centroid.lon}`)

    // Load indicator registry rows
    const { data: indicatorRows, error: indicatorError } = await supabase
      .from('indicators')
      .select('id, code, unit, default_ttl_days')
      .in('code', indicatorCodes)

    if (indicatorError) {
      console.error('[get-climate-indicators] Failed to load indicators:', indicatorError)
      return new Response(
        JSON.stringify({ error: 'Indicator registry lookup failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const indicators = (indicatorRows || []) as IndicatorMetaRow[]
    const byCode = new Map(indicators.map((i) => [i.code, i]))

    for (const code of indicatorCodes) {
      if (!byCode.has(code)) {
        return new Response(
          JSON.stringify({ error: `Indikator '${code}' nicht in der Registry gefunden` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const nowIso = new Date().toISOString()
    const indicatorIds = indicators.map((i) => i.id)

    // Check cache
    const { data: cachedRows, error: cacheError } = await supabase
      .from('indicator_values')
      .select('indicator_id, value, year, computed_at, expires_at, source_dataset_key')
      .eq('region_id', p_region_id)
      .in('indicator_id', indicatorIds)
      .eq('year', requestYear)
      .is('scenario', null)
      .is('period_start', null)
      .is('period_end', null)
      .gt('expires_at', nowIso)

    if (cacheError) {
      console.error('[get-climate-indicators] Cache query error:', cacheError)
      // Continue (we can still compute)
    }

    const cachedByIndicatorId = new Map<string, any>((cachedRows || []).map((r: any) => [r.indicator_id, r]))
    const values: Array<{
      indicator_code: string
      value: number | null
      unit: string
      year: number
      scenario: string | null
      period_start: number
      period_end: number
      is_baseline: boolean
      dataset_key: string
      cached: boolean
    }> = []

    const datasetsUsed = new Set<string>()
    let allCached = true

    for (const code of indicatorCodes) {
      const indicator = byCode.get(code)!
      const cached = cachedByIndicatorId.get(indicator.id)

      if (cached && typeof cached.value === 'number') {
        console.log(`[get-climate-indicators] Cache hit: ${code}=${cached.value} (year=${requestYear})`)
        datasetsUsed.add(cached.source_dataset_key || DATASET_ERA5.key)
        values.push({
          indicator_code: code,
          value: cached.value,
          unit: indicator.unit || '°C',
          year: requestYear,
          scenario: null,
          period_start: requestYear,
          period_end: requestYear,
          is_baseline: true,
          dataset_key: cached.source_dataset_key || DATASET_ERA5.key,
          cached: true,
        })
        continue
      }

      allCached = false

      if (code !== 'temp_mean_annual') {
        // We only compute temp_mean_annual right now.
        values.push({
          indicator_code: code,
          value: null,
          unit: indicator.unit || '',
          year: requestYear,
          scenario: null,
          period_start: requestYear,
          period_end: requestYear,
          is_baseline: true,
          dataset_key: DATASET_ERA5.key,
          cached: false,
        })
        continue
      }

      console.log(`[get-climate-indicators] Cache miss: ${code} (year=${requestYear}) → fetching Open-Meteo…`)
      const computed = await fetchAnnualMeanTempC(centroid.lat, centroid.lon, requestYear)
      if ('error' in computed) {
        // Clear backend error, not silent
        return new Response(
          JSON.stringify({ error: `Open-Meteo fehlgeschlagen: ${computed.error}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      datasetsUsed.add(DATASET_ERA5.key)

      const ttlDays = indicator.default_ttl_days || 90
      const computedAt = nowIso
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()

      console.log('[get-climate-indicators] Writing cache…', {
        region_id: p_region_id,
        indicator_code: code,
        year: requestYear,
        computed_at: computedAt,
        expires_at: expiresAt,
      })

      const { error: upsertError } = await supabase
        .from('indicator_values')
        .upsert(
          {
            indicator_id: indicator.id,
            region_id: p_region_id,
            value: computed.value,
            year: requestYear,
            scenario: null,
            period_start: null,
            period_end: null,
            computed_at: computedAt,
            expires_at: expiresAt,
            stale: false,
            source_dataset_key: DATASET_ERA5.key,
            source_meta: {
              lat: centroid.lat,
              lon: centroid.lon,
              source_api: 'open-meteo',
              daily_readings: computed.dailyCount,
            },
          },
          {
            onConflict: 'indicator_id,region_id,year,scenario,period_start,period_end',
          }
        )

      if (upsertError) {
        console.error('[get-climate-indicators] Cache upsert error:', upsertError)
        // Still return computed value (don’t block UI)
      }

      values.push({
        indicator_code: code,
        value: computed.value,
        unit: indicator.unit || '°C',
        year: requestYear,
        scenario: null,
        period_start: requestYear,
        period_end: requestYear,
        is_baseline: true,
        dataset_key: DATASET_ERA5.key,
        cached: false,
      })
    }

    // Attribution via registry
    let attribution: any[] = []
    const { data: sources, error: sourcesError } = await supabase.rpc('get_indicator_sources', {
      p_indicator_codes: indicatorCodes,
    })
    if (sourcesError) {
      console.error('[get-climate-indicators] get_indicator_sources failed:', sourcesError)
      attribution = [
        {
          indicator_code: 'temp_mean_annual',
          dataset_key: DATASET_ERA5.key,
          dataset_name: 'ERA5-Land Hourly Data',
          provider: 'Copernicus Climate Change Service (C3S)',
          license: 'CC BY 4.0',
          attribution: DATASET_ERA5.attribution,
          url: 'https://cds.climate.copernicus.eu/cdsapp#!/dataset/reanalysis-era5-land',
        },
      ]
    } else {
      attribution = sources || []
    }

    const elapsed = Date.now() - startTime
    console.log(`[get-climate-indicators] Complete: ${values.length} values, cached=${allCached}, ${elapsed}ms`)

    return new Response(
      JSON.stringify({
        values,
        attribution,
        datasets_used: Array.from(datasetsUsed),
        cached: allCached,
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
