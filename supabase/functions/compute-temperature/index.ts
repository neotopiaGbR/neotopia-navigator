import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Indicator code we're handling
const INDICATOR_CODE = 'temp_mean_annual'

// Dataset priorities for Germany
const DATASETS = {
  dwd: {
    key: 'dwd_cdc',
    name: 'DWD Climate Data Center',
    provider: 'Deutscher Wetterdienst',
    attribution: 'Deutscher Wetterdienst (DWD), Climate Data Center. Lizenz: DL-DE/BY-2.0',
    coverage: 'DE',
  },
  era5: {
    key: 'copernicus_era5_land',
    name: 'ERA5-Land',
    provider: 'Copernicus C3S',
    attribution: 'Copernicus Climate Change Service (C3S), ERA5-Land hourly data. Licence: CC BY 4.0',
    coverage: 'global',
  },
}

// Open-Meteo Archive API (uses ERA5 data, free, no API key)
const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

interface ComputeResult {
  success: boolean
  value: number | null
  year: number
  dataset_key: string
  attribution: string
  cached: boolean
  computed_at: string
  expires_at: string
  error?: string
}

/**
 * Fetch annual mean temperature from Open-Meteo Archive API
 * Uses ERA5-Land reanalysis data
 */
async function fetchFromOpenMeteo(
  lat: number,
  lon: number,
  year: number
): Promise<{ value: number | null; error?: string }> {
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
  console.log(`[compute-temperature] Fetching from Open-Meteo: ${url}`)

  try {
    const response = await fetch(url)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('[compute-temperature] Open-Meteo error:', response.status, errorText)
      return { value: null, error: `Open-Meteo API error: ${response.status}` }
    }

    const data = await response.json()
    
    if (!data.daily?.temperature_2m_mean) {
      console.error('[compute-temperature] No temperature data in response')
      return { value: null, error: 'No temperature data available' }
    }

    // Calculate annual mean from daily means
    const dailyTemps: number[] = data.daily.temperature_2m_mean.filter(
      (v: number | null) => v !== null
    )
    
    if (dailyTemps.length === 0) {
      return { value: null, error: 'No valid temperature readings' }
    }

    const annualMean = dailyTemps.reduce((sum, t) => sum + t, 0) / dailyTemps.length
    const roundedMean = Math.round(annualMean * 10) / 10

    console.log(`[compute-temperature] Computed annual mean: ${roundedMean}°C from ${dailyTemps.length} daily readings`)

    return { value: roundedMean }
  } catch (err) {
    console.error('[compute-temperature] Fetch error:', err)
    return { value: null, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/**
 * Check if location is in Germany (rough bounding box)
 */
function isInGermany(lat: number, lon: number): boolean {
  return lat >= 47.2 && lat <= 55.1 && lon >= 5.8 && lon <= 15.1
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const body = await req.json()
    const {
      region_id,
      lat,
      lon,
      year = new Date().getFullYear() - 1, // Default to last complete year
      force_refresh = false,
    } = body

    console.log(`[compute-temperature] Request: region_id=${region_id}, lat=${lat}, lon=${lon}, year=${year}`)

    // Validate inputs
    if (!region_id && (!lat || !lon)) {
      return new Response(
        JSON.stringify({ error: 'region_id oder lat/lon erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Resolve coordinates if region_id provided
    let resolvedLat = lat
    let resolvedLon = lon
    let resolvedRegionId = region_id

    if (region_id && (!lat || !lon)) {
      // Get region centroid
      const { data: centroidData, error: centroidError } = await supabase.rpc(
        'get_region_centroid',
        { p_region_id: region_id }
      )

      if (centroidError) {
        console.error('[compute-temperature] Centroid RPC error:', centroidError)
        // Fallback: try to extract from geometry
        const { data: regionGeom } = await supabase
          .from('regions')
          .select('geom')
          .eq('id', region_id)
          .single()

        if (regionGeom?.geom) {
          const geom = regionGeom.geom as { type: string; coordinates: number[][][][] | number[][][] }
          if (geom.type === 'MultiPolygon') {
            const coords = (geom.coordinates as number[][][][])[0][0]
            const lons = coords.map(c => c[0])
            const lats = coords.map(c => c[1])
            resolvedLon = lons.reduce((a, b) => a + b, 0) / lons.length
            resolvedLat = lats.reduce((a, b) => a + b, 0) / lats.length
          } else if (geom.type === 'Polygon') {
            const coords = (geom.coordinates as number[][][])[0]
            const lons = coords.map(c => c[0])
            const lats = coords.map(c => c[1])
            resolvedLon = lons.reduce((a, b) => a + b, 0) / lons.length
            resolvedLat = lats.reduce((a, b) => a + b, 0) / lats.length
          }
        }
      } else if (centroidData) {
        resolvedLat = centroidData.lat
        resolvedLon = centroidData.lon
      }
    }

    if (!resolvedLat || !resolvedLon) {
      return new Response(
        JSON.stringify({ error: 'Koordinaten konnten nicht ermittelt werden' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If we only have coordinates but no region_id, create/get the grid region
    if (!resolvedRegionId) {
      const { data: regionData, error: regionError } = await supabase.rpc('ensure_grid_region', {
        p_lat: resolvedLat,
        p_lon: resolvedLon,
      })

      if (regionError) {
        console.error('[compute-temperature] ensure_grid_region error:', regionError)
        return new Response(
          JSON.stringify({ error: 'Region konnte nicht erstellt werden' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      resolvedRegionId = regionData
    }

    console.log(`[compute-temperature] Resolved: region=${resolvedRegionId}, lat=${resolvedLat}, lon=${resolvedLon}`)

    // Get indicator ID
    const { data: indicator, error: indicatorError } = await supabase
      .from('indicators')
      .select('id, default_ttl_days')
      .eq('code', INDICATOR_CODE)
      .single()

    if (indicatorError || !indicator) {
      console.error('[compute-temperature] Indicator not found:', indicatorError)
      return new Response(
        JSON.stringify({ error: `Indikator ${INDICATOR_CODE} nicht gefunden` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const ttlDays = indicator.default_ttl_days || 180

    // Check cache if not forcing refresh
    if (!force_refresh) {
      const { data: cached, error: cacheError } = await supabase
        .from('indicator_values')
        .select('value, computed_at, expires_at, source_dataset_key')
        .eq('indicator_id', indicator.id)
        .eq('region_id', resolvedRegionId)
        .eq('year', year)
        .is('scenario', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

      if (!cacheError && cached) {
        const datasetInfo = cached.source_dataset_key === DATASETS.dwd.key 
          ? DATASETS.dwd 
          : DATASETS.era5

        console.log(`[compute-temperature] Cache hit: ${cached.value}°C (expires: ${cached.expires_at})`)

        const result: ComputeResult = {
          success: true,
          value: cached.value,
          year,
          dataset_key: datasetInfo.key,
          attribution: datasetInfo.attribution,
          cached: true,
          computed_at: cached.computed_at,
          expires_at: cached.expires_at,
        }

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    console.log('[compute-temperature] Cache miss, fetching from source...')

    // Determine which dataset to use (priority: DWD for Germany, ERA5 fallback)
    const inGermany = isInGermany(resolvedLat, resolvedLon)
    let datasetUsed = inGermany ? DATASETS.dwd : DATASETS.era5

    // For now, we always use Open-Meteo which provides ERA5 data
    // DWD integration would require a separate connector with their API
    // Here we simulate DWD priority by using ERA5 but noting source
    
    // Fetch from Open-Meteo (ERA5)
    const { value, error: fetchError } = await fetchFromOpenMeteo(resolvedLat, resolvedLon, year)

    if (fetchError || value === null) {
      console.error('[compute-temperature] Fetch failed:', fetchError)
      
      // Return error result but don't fail completely
      const result: ComputeResult = {
        success: false,
        value: null,
        year,
        dataset_key: datasetUsed.key,
        attribution: datasetUsed.attribution,
        cached: false,
        computed_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
        error: fetchError || 'Daten nicht verfügbar',
      }

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Store in cache
    const computedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()

    // For Germany, we note DWD as preferred but actually use ERA5 via Open-Meteo
    // Full DWD integration would be a separate task
    datasetUsed = DATASETS.era5 // Actually using ERA5 via Open-Meteo

    const { error: upsertError } = await supabase
      .from('indicator_values')
      .upsert(
        {
          indicator_id: indicator.id,
          region_id: resolvedRegionId,
          value,
          year,
          scenario: null,
          period_start: null,
          period_end: null,
          computed_at: computedAt,
          expires_at: expiresAt,
          stale: false,
          source_dataset_key: datasetUsed.key,
          source_meta: {
            lat: resolvedLat,
            lon: resolvedLon,
            source_api: 'open-meteo',
            daily_readings: 365,
          },
        },
        {
          onConflict: 'indicator_id,region_id,year,scenario,period_start,period_end',
        }
      )

    if (upsertError) {
      console.error('[compute-temperature] Cache upsert error:', upsertError)
    } else {
      console.log('[compute-temperature] Cached successfully, expires:', expiresAt)
    }

    const elapsed = Date.now() - startTime
    console.log(`[compute-temperature] Complete: ${value}°C in ${elapsed}ms`)

    const result: ComputeResult = {
      success: true,
      value,
      year,
      dataset_key: datasetUsed.key,
      attribution: datasetUsed.attribution,
      cached: false,
      computed_at: computedAt,
      expires_at: expiresAt,
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[compute-temperature] Error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Temperaturberechnung fehlgeschlagen',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
