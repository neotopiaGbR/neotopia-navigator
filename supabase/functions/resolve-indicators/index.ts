import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// Connector registry - maps connector_key to handler
interface ConnectorResult {
  values: Array<{
    indicator_code: string
    value: number | null
    value_text: string | null
    meta?: Record<string, unknown>
  }>
  dataset_key: string
  ttl_days: number
}

// Stub connector - returns null values with proper attribution
async function stubConnector(
  connectorKey: string,
  datasetKey: string,
  indicatorCodes: string[],
  _regionId: string,
  _centroid: { lat: number; lon: number } | null,
  _params: Record<string, unknown>
): Promise<ConnectorResult> {
  console.log(`[resolve-indicators] Stub connector '${connectorKey}' for dataset '${datasetKey}'`)
  
  return {
    values: indicatorCodes.map(code => ({
      indicator_code: code,
      value: null,
      value_text: null,
      meta: { 
        status: 'data_unavailable',
        reason: 'Connector not yet integrated',
        connector: connectorKey,
      },
    })),
    dataset_key: datasetKey,
    ttl_days: 1, // Short TTL for stubs
  }
}

// OSM connector - basic distance/count queries
async function osmConnector(
  indicatorCodes: string[],
  _regionId: string,
  centroid: { lat: number; lon: number } | null,
  mappings: Array<{ indicator_code: string; params: Record<string, unknown> }>
): Promise<ConnectorResult> {
  console.log(`[resolve-indicators] OSM connector for ${indicatorCodes.length} indicators`)
  
  if (!centroid) {
    return {
      values: indicatorCodes.map(code => ({
        indicator_code: code,
        value: null,
        value_text: null,
        meta: { status: 'no_centroid' },
      })),
      dataset_key: 'osm',
      ttl_days: 30,
    }
  }

  // For now return stubs - full Overpass integration requires rate limiting
  const values = indicatorCodes.map(code => {
    const mapping = mappings.find(m => m.indicator_code === code)
    const queryType = (mapping?.params as Record<string, unknown>)?.type as string || 'count'
    
    // Return placeholder values
    return {
      indicator_code: code,
      value: null,
      value_text: null,
      meta: { 
        status: 'pending_integration',
        query_type: queryType,
        centroid,
      },
    }
  })

  return {
    values,
    dataset_key: 'osm',
    ttl_days: 30,
  }
}

// Temperature connector - uses compute-temperature edge function for real data
async function temperatureConnector(
  supabaseUrl: string,
  supabaseKey: string,
  indicatorCodes: string[],
  regionId: string,
  centroid: { lat: number; lon: number } | null,
  year: number
): Promise<ConnectorResult> {
  console.log(`[resolve-indicators] Temperature connector for ${indicatorCodes.length} indicators`)
  
  const values: ConnectorResult['values'] = []
  
  for (const code of indicatorCodes) {
    if (code === 'temp_mean_annual' && centroid) {
      try {
        // Call the compute-temperature edge function
        const response = await fetch(`${supabaseUrl}/functions/v1/compute-temperature`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            region_id: regionId,
            lat: centroid.lat,
            lon: centroid.lon,
            year,
          }),
        })

        if (response.ok) {
          const result = await response.json()
          console.log(`[resolve-indicators] Temperature result:`, result)
          
          if (result.success && result.value !== null) {
            values.push({
              indicator_code: code,
              value: result.value,
              value_text: null,
              meta: {
                status: 'computed',
                cached: result.cached,
                source_api: 'open-meteo',
                dataset_key: result.dataset_key,
              },
            })
            continue
          }
        }
      } catch (err) {
        console.error(`[resolve-indicators] Temperature fetch error:`, err)
      }
    }
    
    // Fallback for failed or unsupported indicators
    values.push({
      indicator_code: code,
      value: null,
      value_text: null,
      meta: { status: 'fetch_failed' },
    })
  }

  return {
    values,
    dataset_key: 'copernicus_era5_land',
    ttl_days: 180,
  }
}

// Climate connector stub (for non-temperature climate indicators)
async function climateConnector(
  indicatorCodes: string[],
  _regionId: string,
  centroid: { lat: number; lon: number } | null,
  _year: number,
  scenario: string | null,
  periodStart: number | null,
  periodEnd: number | null
): Promise<ConnectorResult> {
  console.log(`[resolve-indicators] Climate connector: scenario=${scenario}, period=${periodStart}-${periodEnd}`)
  
  // For demo, return realistic sample values for some indicators
  const sampleValues: Record<string, number> = {
    'TEMP_MEAN': 10.5 + (scenario === 'ssp585' ? 3.2 : scenario === 'ssp245' ? 1.8 : 0),
    'TEMP_SUMMER_MEAN': 18.2 + (scenario === 'ssp585' ? 4.1 : scenario === 'ssp245' ? 2.3 : 0),
    'HOT_DAYS_30C': 8 + (scenario === 'ssp585' ? 25 : scenario === 'ssp245' ? 12 : 0),
    'TROPICAL_NIGHTS_20C': 2 + (scenario === 'ssp585' ? 18 : scenario === 'ssp245' ? 8 : 0),
    'PRECIP_TOTAL': 750 + (scenario === 'ssp585' ? -80 : scenario === 'ssp245' ? -40 : 0),
  }

  const values = indicatorCodes.map(code => ({
    indicator_code: code,
    value: sampleValues[code] ?? null,
    value_text: code === 'CLIMATE_ANALOG_CITY' ? (scenario === 'ssp585' ? 'Rom' : scenario === 'ssp245' ? 'Lyon' : null) : null,
    meta: { 
      status: sampleValues[code] !== undefined ? 'sample_data' : 'pending_integration',
      scenario: scenario || 'historical',
      period: `${periodStart || 1991}-${periodEnd || 2020}`,
      centroid,
    },
  }))

  return {
    values,
    dataset_key: scenario ? 'euro_cordex' : 'copernicus_era5',
    ttl_days: 180,
  }
}

// Demography connector stub
async function demographyConnector(
  indicatorCodes: string[],
  _regionId: string,
  _centroid: { lat: number; lon: number } | null
): Promise<ConnectorResult> {
  console.log(`[resolve-indicators] Demography connector for ${indicatorCodes.length} indicators`)

  // Sample values for demo
  const sampleValues: Record<string, number> = {
    'POPULATION': Math.floor(Math.random() * 5000) + 500,
    'POPULATION_DENSITY': Math.floor(Math.random() * 3000) + 100,
    'MEDIAN_AGE': 42 + Math.random() * 10,
    'SHARE_OVER_65': 18 + Math.random() * 12,
  }

  const values = indicatorCodes.map(code => ({
    indicator_code: code,
    value: sampleValues[code] ?? null,
    value_text: null,
    meta: { 
      status: sampleValues[code] !== undefined ? 'sample_data' : 'pending_integration',
    },
  }))

  return {
    values,
    dataset_key: 'eurostat_geostat',
    ttl_days: 365,
  }
}

// Land use connector stub
async function landuseConnector(
  indicatorCodes: string[],
  _regionId: string,
  _centroid: { lat: number; lon: number } | null
): Promise<ConnectorResult> {
  console.log(`[resolve-indicators] Land use connector for ${indicatorCodes.length} indicators`)

  const sampleValues: Record<string, number> = {
    'IMPERVIOUSNESS': Math.random() * 80,
    'GREEN_SHARE': 20 + Math.random() * 40,
    'BUILTUP_SHARE': 10 + Math.random() * 50,
    'FOREST_SHARE': Math.random() * 30,
  }

  const values = indicatorCodes.map(code => ({
    indicator_code: code,
    value: sampleValues[code] ?? null,
    value_text: null,
    meta: { 
      status: sampleValues[code] !== undefined ? 'sample_data' : 'pending_integration',
    },
  }))

  return {
    values,
    dataset_key: 'copernicus_clc',
    ttl_days: 365,
  }
}

// Air quality connector stub
async function airqualityConnector(
  indicatorCodes: string[],
  _regionId: string,
  _centroid: { lat: number; lon: number } | null
): Promise<ConnectorResult> {
  console.log(`[resolve-indicators] Air quality connector for ${indicatorCodes.length} indicators`)

  const sampleValues: Record<string, number> = {
    'NO2_MEAN': 15 + Math.random() * 25,
    'PM25_MEAN': 8 + Math.random() * 12,
    'PM10_MEAN': 18 + Math.random() * 15,
    'O3_MEAN': 45 + Math.random() * 20,
  }

  const values = indicatorCodes.map(code => ({
    indicator_code: code,
    value: sampleValues[code] ?? null,
    value_text: null,
    meta: { 
      status: sampleValues[code] !== undefined ? 'sample_data' : 'pending_integration',
      nearest_station: 'DEMO_STATION',
      distance_km: (Math.random() * 10).toFixed(1),
    },
  }))

  return {
    values,
    dataset_key: 'eea_aq',
    ttl_days: 30,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Parse and validate request body
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: 'Ungültiger JSON-Body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract and validate parameters
    const region_id = typeof body.region_id === 'string' ? body.region_id : undefined
    const lat = typeof body.lat === 'number' ? body.lat : undefined
    const lon = typeof body.lon === 'number' ? body.lon : undefined
    const grid_code = typeof body.grid_code === 'string' ? body.grid_code : undefined
    const indicator_codes = Array.isArray(body.indicator_codes) ? body.indicator_codes.filter((c): c is string => typeof c === 'string') : undefined
    const year = typeof body.year === 'number' ? body.year : new Date().getFullYear()
    const scenario = typeof body.scenario === 'string' ? body.scenario : undefined
    const period_start = typeof body.period_start === 'number' ? body.period_start : undefined
    const period_end = typeof body.period_end === 'number' ? body.period_end : undefined
    const force_refresh = body.force_refresh === true

    // Validate year range
    if (year < 1900 || year > 2200) {
      return new Response(
        JSON.stringify({ error: 'Jahr muss zwischen 1900 und 2200 liegen' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate lat/lon if provided
    if (lat !== undefined && (lat < -90 || lat > 90)) {
      return new Response(
        JSON.stringify({ error: 'Breitengrad muss zwischen -90 und 90 liegen' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (lon !== undefined && (lon < -180 || lon > 180)) {
      return new Response(
        JSON.stringify({ error: 'Längengrad muss zwischen -180 und 180 liegen' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[resolve-indicators] Request: region_id=${region_id}, codes=${indicator_codes?.length || 'all'}, year=${year}, scenario=${scenario}`)

    // ========================================
    // STEP 1: Resolve region_id
    // ========================================
    let resolvedRegionId = region_id
    let centroid: { lat: number; lon: number } | null = null

    if (!resolvedRegionId && lat && lon) {
      // Use ensure_grid_region to get/create the grid cell
      const { data: regionData, error: regionError } = await supabase.rpc('ensure_grid_region', {
        p_lat: lat,
        p_lon: lon,
      })
      
      if (regionError) {
        console.error('[resolve-indicators] ensure_grid_region error:', regionError)
        throw new Error('Region konnte nicht aufgelöst werden')
      }
      
      resolvedRegionId = regionData
      centroid = { lat, lon }
    } else if (!resolvedRegionId && grid_code) {
      // Look up by grid_code
      const { data: regionData, error: regionError } = await supabase
        .from('regions')
        .select('id')
        .eq('grid_code', grid_code)
        .maybeSingle()
      
      if (regionError || !regionData) {
        throw new Error(`Grid-Zelle ${grid_code} nicht gefunden`)
      }
      
      resolvedRegionId = regionData.id
    }

    if (!resolvedRegionId) {
      return new Response(
        JSON.stringify({ error: 'region_id, lat/lon oder grid_code erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get region centroid if not already known
    if (!centroid) {
      const { data: regionGeom } = await supabase
        .from('regions')
        .select('geom')
        .eq('id', resolvedRegionId)
        .single()
      
      if (regionGeom?.geom) {
        // Extract centroid from geometry (simplified)
        try {
          const geom = regionGeom.geom as { type: string; coordinates: number[][][][] | number[][][] }
          if (geom.type === 'MultiPolygon') {
            const coords = (geom.coordinates as number[][][][])[0][0][0]
            centroid = { lon: coords[0], lat: coords[1] }
          } else if (geom.type === 'Polygon') {
            const coords = (geom.coordinates as number[][][])[0][0]
            centroid = { lon: coords[0], lat: coords[1] }
          }
        } catch {
          console.warn('[resolve-indicators] Could not extract centroid')
        }
      }
    }

    // ========================================
    // STEP 2: Get requested indicators
    // ========================================
    let requestedCodes: string[] = indicator_codes || []
    
    if (requestedCodes.length === 0) {
      // Get all indicator codes
      const { data: allIndicators } = await supabase
        .from('indicators')
        .select('code')
        .order('domain, name')
      requestedCodes = allIndicators?.map(i => i.code) || []
    }

    console.log(`[resolve-indicators] Resolving ${requestedCodes.length} indicators`)

    // ========================================
    // STEP 3: Get indicator metadata + mappings
    // ========================================
    const { data: indicators } = await supabase
      .from('indicators')
      .select('id, code, name, unit, domain, format, precision, direction')
      .in('code', requestedCodes)

    const indicatorMap = new Map(indicators?.map(i => [i.code, i]) || [])
    const indicatorIdToCode = new Map(indicators?.map(i => [i.id, i.code]) || [])

    // Get dataset mappings
    const { data: mappings } = await supabase.rpc('get_indicator_connectors', {
      p_indicator_codes: requestedCodes,
    })

    const mappingsByCode = new Map<string, Array<{ 
      dataset_key: string
      connector_key: string
      priority: number
      params: Record<string, unknown>
      dataset: { name: string; provider: string; attribution: string; license: string }
    }>>()
    
    for (const m of (mappings || [])) {
      const existing = mappingsByCode.get(m.indicator_code) || []
      existing.push(m)
      mappingsByCode.set(m.indicator_code, existing)
    }

    // ========================================
    // STEP 4: Check cache
    // ========================================
    const indicatorIds = Array.from(indicatorMap.values()).map(i => i.id)
    
    // Query cache - only select columns that exist in the table
    let cacheQuery = supabase
      .from('indicator_values')
      .select('indicator_id, value, value_text, year, scenario, period_start, period_end, computed_at, expires_at, stale')
      .eq('region_id', resolvedRegionId)
      .in('indicator_id', indicatorIds)

    if (!force_refresh) {
      cacheQuery = cacheQuery.gt('expires_at', new Date().toISOString())
    }

    if (year) {
      cacheQuery = cacheQuery.eq('year', year)
    }
    if (scenario) {
      cacheQuery = cacheQuery.eq('scenario', scenario)
    } else {
      cacheQuery = cacheQuery.is('scenario', null)
    }
    if (period_start && period_end) {
      cacheQuery = cacheQuery.eq('period_start', period_start).eq('period_end', period_end)
    }

    const { data: cachedValues, error: cacheError } = await cacheQuery

    if (cacheError) {
      console.error('[resolve-indicators] Cache query error:', cacheError)
    }

    // Build result from cache
    const resultMap = new Map<string, {
      indicator_code: string
      indicator_name: string
      value: number | null
      value_text: string | null
      unit: string
      domain: string
      format: string
      precision: number
      direction: string
      year: number | null
      scenario: string | null
      source_dataset_key: string | null
      source_attribution: string | null
      cached: boolean
      data_available: boolean
      meta: Record<string, unknown> | null
    }>()

    const datasetsUsed = new Set<string>()
    let cachedCount = 0

    for (const cached of cachedValues || []) {
      const code = indicatorIdToCode.get(cached.indicator_id)
      if (!code) continue
      const indicator = indicatorMap.get(code)
      if (!indicator) continue

      cachedCount++
      resultMap.set(code, {
        indicator_code: code,
        indicator_name: indicator.name,
        value: cached.value,
        value_text: cached.value_text,
        unit: indicator.unit,
        domain: indicator.domain,
        format: indicator.format || 'number',
        precision: indicator.precision || 1,
        direction: indicator.direction || 'neutral',
        year: cached.year,
        scenario: cached.scenario || null,
        source_dataset_key: null,
        source_attribution: null,
        cached: true,
        data_available: cached.value !== null || cached.value_text !== null,
        meta: null,
      })
    }

    console.log(`[resolve-indicators] Cache hits: ${cachedCount}/${requestedCodes.length}`)

    // ========================================
    // STEP 5: Compute missing indicators
    // ========================================
    const missingCodes = requestedCodes.filter(code => !resultMap.has(code))
    let computedCount = 0

    if (missingCodes.length > 0) {
      console.log(`[resolve-indicators] Computing ${missingCodes.length} missing indicators`)

      // Group by connector
      const byConnector = new Map<string, {
        codes: string[]
        datasetKey: string
        mappings: Array<{ indicator_code: string; params: Record<string, unknown> }>
      }>()

      for (const code of missingCodes) {
        const codeMappings = mappingsByCode.get(code) || []
        if (codeMappings.length === 0) continue

        // Use highest priority mapping
        const best = codeMappings.sort((a, b) => b.priority - a.priority)[0]
        const existing = byConnector.get(best.connector_key) || { 
          codes: [], 
          datasetKey: best.dataset_key,
          mappings: [],
        }
        existing.codes.push(code)
        existing.mappings.push({ indicator_code: code, params: best.params })
        byConnector.set(best.connector_key, existing)
      }

      // Call each connector
      for (const [connectorKey, group] of byConnector) {
        let result: ConnectorResult

        try {
          switch (connectorKey) {
            case 'temperature':
              result = await temperatureConnector(
                supabaseUrl,
                supabaseKey,
                group.codes,
                resolvedRegionId,
                centroid,
                year
              )
              break
            
            case 'climate':
            case 'climate_analog':
              result = await climateConnector(
                group.codes, 
                resolvedRegionId, 
                centroid,
                year,
                scenario || null,
                period_start || null,
                period_end || null
              )
              break
            
            case 'demography':
              result = await demographyConnector(group.codes, resolvedRegionId, centroid)
              break
            
            case 'landuse':
              result = await landuseConnector(group.codes, resolvedRegionId, centroid)
              break
            
            case 'airquality':
              result = await airqualityConnector(group.codes, resolvedRegionId, centroid)
              break
            
            case 'osm':
              result = await osmConnector(group.codes, resolvedRegionId, centroid, group.mappings)
              break
            
            default:
              result = await stubConnector(connectorKey, group.datasetKey, group.codes, resolvedRegionId, centroid, {})
          }
        } catch (err) {
          console.error(`[resolve-indicators] Connector ${connectorKey} failed:`, err)
          result = await stubConnector(connectorKey, group.datasetKey, group.codes, resolvedRegionId, centroid, {})
        }

        datasetsUsed.add(result.dataset_key)

        // Store results in cache and add to response
        for (const v of result.values) {
          const indicator = indicatorMap.get(v.indicator_code)
          if (!indicator) continue

          computedCount++

          // Upsert to cache
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + result.ttl_days)

          // Upsert to cache - only use columns that exist
          const { error: upsertError } = await supabase
            .from('indicator_values')
            .upsert({
              indicator_id: indicator.id,
              region_id: resolvedRegionId,
              value: v.value,
              value_text: v.value_text,
              year,
              scenario: scenario || null,
              period_start: period_start || null,
              period_end: period_end || null,
              computed_at: new Date().toISOString(),
              expires_at: expiresAt.toISOString(),
              stale: false,
            }, {
              onConflict: 'indicator_id,region_id,year,scenario,period_start,period_end',
            })

          if (upsertError) {
            console.error(`[resolve-indicators] Cache upsert error for ${v.indicator_code}:`, upsertError)
          }

          resultMap.set(v.indicator_code, {
            indicator_code: v.indicator_code,
            indicator_name: indicator.name,
            value: v.value,
            value_text: v.value_text,
            unit: indicator.unit,
            domain: indicator.domain,
            format: indicator.format || 'number',
            precision: indicator.precision || 1,
            direction: indicator.direction || 'neutral',
            year,
            scenario: scenario || null,
            source_dataset_key: result.dataset_key,
            source_attribution: null,
            cached: false,
            data_available: v.value !== null || v.value_text !== null,
            meta: v.meta || null,
          })
        }
      }
    }

    // ========================================
    // STEP 6: Get attributions for used datasets
    // ========================================
    const { data: datasetInfo } = await supabase
      .from('datasets')
      .select('dataset_key, provider, attribution, license')
      .in('dataset_key', Array.from(datasetsUsed))

    const attributions = (datasetInfo || []).map(d => ({
      dataset_key: d.dataset_key,
      provider: d.provider,
      attribution: d.attribution,
      license: d.license,
    }))

    // Add attribution to results
    const attributionMap = new Map(datasetInfo?.map(d => [d.dataset_key, d.attribution]) || [])
    for (const item of resultMap.values()) {
      if (item.source_dataset_key) {
        item.source_attribution = attributionMap.get(item.source_dataset_key) || null
      }
    }

    // ========================================
    // STEP 7: Return response
    // ========================================
    const elapsed = Date.now() - startTime
    console.log(`[resolve-indicators] Complete: ${cachedCount} cached, ${computedCount} computed, ${elapsed}ms`)

    return new Response(
      JSON.stringify({
        region_id: resolvedRegionId,
        values: Array.from(resultMap.values()),
        datasets_used: Array.from(datasetsUsed),
        attributions,
        cached_count: cachedCount,
        computed_count: computedCount,
        computed_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[resolve-indicators] Error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Indikatoren konnten nicht aufgelöst werden',
        details: error instanceof Error ? error.stack : undefined,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
