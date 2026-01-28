# DWD HYRAS-DE Temperature Overlay

## Dataset Information

| Property | Value |
|----------|-------|
| **Name** | HYRAS-DE (Hydrologische Rasterdaten für Deutschland) |
| **Provider** | Deutscher Wetterdienst (DWD) |
| **Resolution** | 1 km × 1 km |
| **CRS** | EPSG:3035 (LAEA Europe) |
| **Variables** | Air Temperature (mean, max, min) |
| **Temporal** | Seasonal aggregates (JJA = June-July-August) |
| **License** | CC BY 4.0 |
| **URL** | https://opendata.dwd.de/climate_environment/CDC/grids_germany/seasonal/ |

## Implementation Details

### Edge Function: `get-dwd-temperature`

Fetches DWD HYRAS-DE seasonal ASCII Grid files, parses them, and returns grid data for client-side rendering.

**Input Parameters:**
- `year`: Target year (default: previous year)
- `variable`: `'mean'` | `'max'` | `'min'` (default: `'mean'`)
- `sample`: Sample step (default: 3 = every 3rd cell)

**Output:**
```json
{
  "status": "ok",
  "data": {
    "grid": [{ "lat": 51.5, "lon": 10.0, "value": 18.5 }, ...],
    "bounds": [5.87, 47.27, 15.04, 55.06],
    "year": 2024,
    "variable": "mean",
    "season": "JJA",
    "period": "2024-06-01 to 2024-08-31",
    "resolution_km": 1,
    "normalization": {
      "p5": 16.2,
      "p95": 22.8,
      "min": 14.1,
      "max": 25.3
    }
  },
  "attribution": "Deutscher Wetterdienst (DWD), HYRAS-DE, CC BY 4.0"
}
```

### Data Source URLs

- **Mean Temperature (JJA):** `https://opendata.dwd.de/climate_environment/CDC/grids_germany/seasonal/air_temperature_mean/14_JJA/`
- **Max Temperature (JJA):** `https://opendata.dwd.de/climate_environment/CDC/grids_germany/seasonal/air_temperature_max/14_JJA/`
- **Min Temperature (JJA):** `https://opendata.dwd.de/climate_environment/CDC/grids_germany/seasonal/air_temperature_min/14_JJA/`

File naming: `grids_germany_seasonal_air_temp_{var}_{year}14.asc.gz`

### Coordinate Transformation

The source data is in EPSG:3035 (Lambert Azimuthal Equal Area). The edge function performs approximate coordinate transformation to WGS84 for client-side rendering.

### Frontend Rendering

The layer is rendered using MapLibre GL JS with a GeoJSON source:
- Each grid cell becomes a polygon feature
- Fill color is interpolated based on normalized temperature (P5–P95)
- Color scale: Blue (15°C) → Green (20°C) → Yellow (24°C) → Orange (27°C) → Red (30°C+)

### UI Components

- **LayersControl.tsx**: Toggle, opacity slider, aggregation method selector
- **AirTemperatureLegend.tsx**: On-map legend with color gradient and metadata
- **DwdTemperatureHealthCheck.tsx**: Dev-only health check panel

## Attribution Requirements

When displaying this data, include:
> "© Deutscher Wetterdienst (DWD), HYRAS-DE, CC BY 4.0"
