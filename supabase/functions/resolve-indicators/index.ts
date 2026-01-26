import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Domain mapping for indicator codes
const DOMAIN_INDICATORS: Record<string, string[]> = {
  demography: ['total_population', 'population_density', 'median_age', 'share_over_65'],
  landuse: ['impervious_surface_share', 'green_share', 'urban_share', 'forest_share', 'agricultural_share'],
  airquality: ['no2_annual_mean', 'pm25_annual_mean', 'pm10_annual_mean'],
  osm: ['tree_points_500m', 'green_area_500m', 'public_transport_stops_500m', 'amenities_1km', 'schools_1km', 'healthcare_1km'],
  climate: [
    'mean_annual_temperature', 'summer_mean_temperature', 'heat_days_30c', 'tropical_nights_20c',
    'heatwave_duration_index', 'max_daily_temperature', 'consecutive_dry_days', 'heavy_precip_days_20mm',
    'annual_precipitation_sum', 'summer_precipitation_change', 'winter_precipitation_change',
    'urban_heat_risk_index', 'heat_exposure_population_share',
  ],
}

function getDomainForIndicator(code: string): string | null {
  for (const [domain, codes] of Object.entries(DOMAIN_INDICATORS)) {
    if (codes.includes(code)) return domain
  }
  return null
}

async function invokeConnector(
  supabaseUrl: string,
  supabaseKey: string,
  domain: string,
  regionId: string,
  year: number,
  scenario?: string,
  periodStart?: number,
  periodEnd?: number
): Promise<{ indicators: Array<{ indicator_code: string; value: number | null }>; cached: boolean }> {
  const functionName = domain === 'climate' ? 'get-climate-indicators' : `compute-${domain}`
  
  let body: Record<string, unknown>
  
  if (domain === 'climate') {
    body = {
      p_region_id: regionId,
      p_scenario: scenario || 'historical',
      p_period_start: periodStart || 1991,
      p_period_end: periodEnd || 2020,
    }
  } else {
    body = { region_id: regionId, year }
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Connector ${domain} failed:`, errorText)
    return { indicators: [], cached: false }
  }

  const data = await response.json()
  
  // Climate function returns array directly
  if (domain === 'climate' && Array.isArray(data)) {
    return {
      indicators: data.map((d: { indicator_code: string; value: number }) => ({
        indicator_code: d.indicator_code,
        value: d.value,
      })),
      cached: false,
    }
  }
  
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { 
      region_id, 
      indicator_codes, 
      year = new Date().getFullYear(),
      period_start,
      period_end,
      scenario,
    } = await req.json()

    if (!region_id) {
      return new Response(
        JSON.stringify({ error: 'region_id ist erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If no specific codes requested, return all available cached
    let requestedCodes: string[] = indicator_codes || []
    
    if (requestedCodes.length === 0) {
      // Get all indicator codes
      const { data: allIndicators } = await supabase
        .from('indicators')
        .select('code')
      requestedCodes = allIndicators?.map(i => i.code) || []
    }

    // Group by domain
    const domainGroups = new Map<string, string[]>()
    for (const code of requestedCodes) {
      const domain = getDomainForIndicator(code)
      if (domain) {
        const existing = domainGroups.get(domain) || []
        existing.push(code)
        domainGroups.set(domain, existing)
      }
    }

    // Check cache for all requested indicators
    const { data: indicators } = await supabase
      .from('indicators')
      .select('id, code, name, unit, category')
      .in('code', requestedCodes)

    const indicatorMap = new Map(indicators?.map(i => [i.code, i]) || [])
    const indicatorIdMap = new Map(indicators?.map(i => [i.id, i.code]) || [])

    // Check cache
    let cacheQuery = supabase
      .from('indicator_values')
      .select('indicator_id, value, value_text, year, meta, source_product_key')
      .eq('region_id', region_id)
      .in('indicator_id', Array.from(indicatorMap.values()).map(i => i.id))
      .gt('expires_at', new Date().toISOString())

    if (year) {
      cacheQuery = cacheQuery.eq('year', year)
    }
    if (scenario) {
      cacheQuery = cacheQuery.eq('scenario', scenario)
    }

    const { data: cachedValues } = await cacheQuery

    // Build result from cache
    const resultMap = new Map<string, {
      indicator_code: string
      indicator_name: string
      value: number | null
      value_text: string | null
      unit: string
      year: number | null
      source: string | null
      method: string | null
      meta: Record<string, unknown> | null
    }>()

    for (const cached of cachedValues || []) {
      const code = indicatorIdMap.get(cached.indicator_id)
      if (!code) continue
      const indicator = indicatorMap.get(code)
      if (!indicator) continue

      resultMap.set(code, {
        indicator_code: code,
        indicator_name: indicator.name,
        value: cached.value,
        value_text: cached.value_text,
        unit: indicator.unit,
        year: cached.year,
        source: cached.source_product_key,
        method: (cached.meta as Record<string, unknown>)?.method as string || null,
        meta: cached.meta as Record<string, unknown>,
      })
    }

    // Identify missing indicators
    const missingCodes = requestedCodes.filter(code => !resultMap.has(code))
    
    if (missingCodes.length > 0) {
      // Re-group missing by domain
      const missingDomains = new Map<string, string[]>()
      for (const code of missingCodes) {
        const domain = getDomainForIndicator(code)
        if (domain) {
          const existing = missingDomains.get(domain) || []
          existing.push(code)
          missingDomains.set(domain, existing)
        }
      }

      // Call connectors for missing domains
      const connectorPromises = Array.from(missingDomains.keys()).map(async (domain) => {
        try {
          const result = await invokeConnector(
            supabaseUrl,
            supabaseKey,
            domain,
            region_id,
            year,
            scenario,
            period_start,
            period_end
          )
          return { domain, result }
        } catch (error) {
          console.error(`Connector ${domain} error:`, error)
          return { domain, result: { indicators: [], cached: false } }
        }
      })

      const connectorResults = await Promise.all(connectorPromises)

      // Merge connector results
      for (const { result } of connectorResults) {
        for (const ind of result.indicators) {
          if (!resultMap.has(ind.indicator_code)) {
            const indicator = indicatorMap.get(ind.indicator_code)
            if (indicator) {
              resultMap.set(ind.indicator_code, {
                indicator_code: ind.indicator_code,
                indicator_name: indicator.name,
                value: ind.value,
                value_text: null,
                unit: indicator.unit,
                year,
                source: null,
                method: null,
                meta: null,
              })
            }
          }
        }
      }
    }

    // Collect datasets used
    const datasetsUsed = new Set<string>()
    for (const item of resultMap.values()) {
      if (item.source) datasetsUsed.add(item.source)
    }

    // Return results
    return new Response(
      JSON.stringify({
        indicators: Array.from(resultMap.values()),
        datasets_used: Array.from(datasetsUsed),
        cached: missingCodes.length === 0,
        computed_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Resolve indicators error:', error)
    return new Response(
      JSON.stringify({ error: 'Indikatoren konnten nicht aufgelöst werden' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
