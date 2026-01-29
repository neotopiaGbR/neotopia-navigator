# Data Preparation Scripts

This directory contains Python scripts for preparing geospatial data for the Neotopia Navigator heavy rain risk module.

## Prerequisites

### Required: GDAL Tools

All scripts require GDAL command-line tools (`gdal_translate`, `gdalwarp`, `ogr2ogr`).

**macOS (Homebrew):**
```bash
brew install gdal
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install gdal-bin python3-gdal
```

**Windows:**
Download from [OSGeo4W](https://trac.osgeo.org/osgeo4w/) or use Conda.

### Python Dependencies

```bash
pip install requests geopandas
```

## Scripts

### 1. prepare_kostra.py

Downloads and processes KOSTRA-DWD-2020 precipitation intensity data.

**Data Source:** [DWD Open Data KOSTRA](https://opendata.dwd.de/climate_environment/CDC/grids_germany/return_periods/precipitation/KOSTRA/)

**Outputs:** Cloud Optimized GeoTIFFs (COGs) for different scenarios:
- `kostra_d60min_t10a.tif` - 1 hour duration, 10 year return period
- `kostra_d60min_t100a.tif` - 1 hour duration, 100 year return period
- `kostra_d12h_t10a.tif` - 12 hour duration, 10 year return period
- `kostra_d12h_t100a.tif` - 12 hour duration, 100 year return period
- `kostra_d24h_t10a.tif` - 24 hour duration, 10 year return period
- `kostra_d24h_t100a.tif` - 24 hour duration, 100 year return period

**Usage:**
```bash
# Default output to ./data/kostra
python scripts/prepare_kostra.py

# Custom output directory
python scripts/prepare_kostra.py --output-dir /path/to/output

# Dry run (show what would be done)
python scripts/prepare_kostra.py --dry-run
```

### 2. prepare_catrare.py

Downloads and processes CatRaRE (Catalogue of Radar-based Heavy Rainfall Events).

**Data Source:** [DWD CDC CatRaRE](https://opendata.dwd.de/climate_environment/CDC/grids_germany/hourly/radolan/CatRaRE/)

**Output:** `catrare_recent.json` - GeoJSON with events from the last 10 years

**Usage:**
```bash
# Default (last 10 years)
python scripts/prepare_catrare.py

# Custom time range
python scripts/prepare_catrare.py --years 5

# Create mock data for development
python scripts/prepare_catrare.py --mock

# Force re-download
python scripts/prepare_catrare.py --force-download
```

## Uploading to Supabase Storage

After generating the files, upload them to Supabase Storage:

```bash
# Using Supabase CLI
supabase storage cp ./data/kostra/*.tif supabase://risk-layers/kostra/
supabase storage cp ./data/catrare/catrare_recent.json supabase://risk-layers/catrare/
```

Or use the Supabase Dashboard to upload manually to the `risk-layers` bucket.

## Data Attribution

- **KOSTRA-DWD-2020:** Deutscher Wetterdienst (DWD), © DWD, Datenlizenz Deutschland – Namensnennung – Version 2.0
- **CatRaRE:** Deutscher Wetterdienst (DWD), CC BY 4.0
