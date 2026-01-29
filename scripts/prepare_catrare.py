#!/usr/bin/env python3
"""
CatRaRE (Catalogue of Radar-based Heavy Rainfall Events) Data Preparation Script
PMTiles Edition - Virtual Vector Tiling

This script downloads and processes the CatRaRE dataset from DWD,
converting it to PMTiles format for efficient serverless vector tile serving.

PMTILES BENEFITS:
- Single archive file containing all zoom levels and tiles
- Serverless: works with static hosting via HTTP Range Requests
- No tile server needed - browser fetches tiles directly from Supabase Storage
- Efficient: only visible tiles are downloaded

DEPENDENCIES:
- Python 3.9+
- GDAL (with ogr2ogr): `brew install gdal` or `apt install gdal-bin`
- tippecanoe: `brew install tippecanoe` (macOS) or build from source
- pmtiles CLI (optional, for validation): `npm install -g pmtiles`
- requests: `pip install requests`

SOURCE:
- DWD CDC: https://opendata.dwd.de/climate_environment/CDC/grids_germany/hourly/radolan/CatRaRE/

OUTPUT:
- catrare.pmtiles: Vector tiles archive for efficient streaming
- catrare_recent.json: GeoJSON fallback (optional)

USAGE:
    python scripts/prepare_catrare.py --output-dir ./data/catrare
    python scripts/prepare_catrare.py --mock  # Create test data

Author: Neotopia Navigator
License: MIT
"""

import os
import sys
import argparse
import json
import tempfile
import subprocess
import zipfile
from pathlib import Path
from datetime import datetime
from typing import Optional

try:
    import requests
except ImportError:
    print("ERROR: requests library required. Install with: pip install requests")
    sys.exit(1)


# === CONFIGURATION ===

# CatRaRE data URL (versioned, check for updates periodically)
CATRARE_BASE_URL = "https://opendata.dwd.de/climate_environment/CDC/grids_germany/hourly/radolan/CatRaRE/"
CATRARE_VERSION = "CatRaRE_W3_Eta_v2023.01"  # W3 = Warning level 3 (Unwetter)

# Expected shapefile name pattern
SHAPEFILE_NAME = "CatRaRE_W3_Eta_v2023.01.shp"

# Columns to keep in output (German original names from DWD)
KEEP_COLUMNS = [
    "geometry",
    "ID",            # Event ID
    "DATUM",         # Date (YYYYMMDD format)
    "ANFANG",        # Start time
    "ENDE",          # End time
    "DAUER_H",       # Duration in hours
    "N_MAX",         # Maximum precipitation
    "N_SUMME",       # Total precipitation
    "WARNSTUFE",     # Warning level
    "FLAECHE_KM2",   # Area in km²
]

# Years to include (recent events only)
YEARS_TO_KEEP = 10

# Tippecanoe options for PMTiles generation
TIPPECANOE_OPTIONS = [
    "--minimum-zoom=4",          # Germany overview
    "--maximum-zoom=12",         # Detailed view
    "--drop-densest-as-needed",  # Prevent tile overflow
    "--extend-zooms-if-still-dropping",
    "--force",                   # Overwrite output
    "--layer=catrare",           # Layer name in tiles
    "--attribution=Quelle: DWD, CatRaRE v2023.01",
]


def check_dependencies() -> dict:
    """Verify required tools are available."""
    deps = {
        "ogr2ogr": False,
        "tippecanoe": False,
        "pmtiles": False,  # Optional, for validation
    }
    
    for tool in deps:
        try:
            result = subprocess.run(
                [tool, "--version" if tool != "pmtiles" else "--help"],
                capture_output=True,
                text=True,
                check=False
            )
            deps[tool] = result.returncode == 0 or "pmtiles" in result.stdout.lower()
        except FileNotFoundError:
            deps[tool] = False
    
    return deps


def download_file(url: str, target_path: Path) -> bool:
    """Download a file from URL."""
    print(f"  Downloading: {url}")
    try:
        response = requests.get(url, stream=True, timeout=300)
        response.raise_for_status()
        
        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0
        
        with open(target_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    pct = (downloaded / total_size) * 100
                    print(f"\r  Progress: {pct:.1f}%", end="", flush=True)
        
        print()  # newline after progress
        print(f"  ✓ Downloaded: {target_path.name} ({target_path.stat().st_size / 1024 / 1024:.1f} MB)")
        return True
        
    except requests.RequestException as e:
        print(f"\n  ✗ Download failed: {e}")
        return False


def find_catrare_download_url() -> Optional[str]:
    """Attempt to find the actual download URL for CatRaRE."""
    patterns = [
        f"{CATRARE_BASE_URL}{CATRARE_VERSION}.zip",
        f"{CATRARE_BASE_URL}{CATRARE_VERSION}/{CATRARE_VERSION}.zip",
        f"{CATRARE_BASE_URL}latest.zip",
    ]
    
    for url in patterns:
        try:
            response = requests.head(url, timeout=10, allow_redirects=True)
            if response.status_code == 200:
                return url
        except requests.RequestException:
            continue
    
    return None


def extract_shapefile(zip_path: Path, extract_dir: Path) -> Optional[Path]:
    """Extract shapefile from ZIP archive."""
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            names = zf.namelist()
            print(f"  Archive contains {len(names)} files")
            
            shp_files = [n for n in names if n.endswith('.shp')]
            if not shp_files:
                print("  ✗ No .shp file found in archive")
                return None
            
            zf.extractall(extract_dir)
            
            shp_path = extract_dir / shp_files[0]
            print(f"  ✓ Extracted: {shp_files[0]}")
            return shp_path
            
    except zipfile.BadZipFile as e:
        print(f"  ✗ Invalid ZIP file: {e}")
        return None


def filter_and_convert_to_geojson(
    input_shp: Path,
    output_json: Path,
    min_year: int
) -> bool:
    """Convert Shapefile to GeoJSON with filtering using ogr2ogr."""
    min_date = min_year * 10000 + 101  # e.g., 20140101
    
    try:
        cmd = [
            "ogr2ogr",
            "-f", "GeoJSON",
            "-t_srs", "EPSG:4326",
            "-where", f"DATUM >= {min_date}",
            "-select", ",".join([c for c in KEEP_COLUMNS if c != "geometry"]),
            "-lco", "COORDINATE_PRECISION=5",
            str(output_json),
            str(input_shp)
        ]
        
        print(f"  Running: ogr2ogr with date filter >= {min_date}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        
        if result.returncode != 0:
            print(f"  ✗ ogr2ogr failed: {result.stderr}")
            return False
        
        if not output_json.exists():
            print("  ✗ Output file not created")
            return False
        
        size_mb = output_json.stat().st_size / 1024 / 1024
        print(f"  ✓ Created: {output_json.name} ({size_mb:.1f} MB)")
        
        with open(output_json, 'r', encoding='utf-8') as f:
            data = json.load(f)
            feature_count = len(data.get('features', []))
            print(f"  ✓ Contains {feature_count} events from {min_year} onwards")
        
        return True
        
    except Exception as e:
        print(f"  ✗ Conversion failed: {e}")
        return False


def convert_to_pmtiles(
    geojson_path: Path,
    pmtiles_path: Path
) -> bool:
    """
    Convert GeoJSON to PMTiles using tippecanoe.
    
    PMTiles is a single-file archive containing all vector tiles,
    optimized for serverless hosting via HTTP Range Requests.
    """
    try:
        cmd = [
            "tippecanoe",
            "-o", str(pmtiles_path),
            *TIPPECANOE_OPTIONS,
            str(geojson_path)
        ]
        
        print(f"  Running: tippecanoe (generating PMTiles)...")
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        
        if result.returncode != 0:
            print(f"  ✗ tippecanoe failed: {result.stderr}")
            return False
        
        if not pmtiles_path.exists():
            print("  ✗ PMTiles file not created")
            return False
        
        size_mb = pmtiles_path.stat().st_size / 1024 / 1024
        print(f"  ✓ Created PMTiles: {pmtiles_path.name} ({size_mb:.2f} MB)")
        
        # Validate with pmtiles CLI if available
        try:
            validate_result = subprocess.run(
                ["pmtiles", "show", str(pmtiles_path)],
                capture_output=True,
                text=True,
                check=False
            )
            if validate_result.returncode == 0:
                # Extract some info from output
                lines = validate_result.stdout.strip().split('\n')[:5]
                for line in lines:
                    print(f"    {line}")
        except FileNotFoundError:
            pass  # pmtiles CLI not installed, skip validation
        
        return True
        
    except Exception as e:
        print(f"  ✗ PMTiles conversion failed: {e}")
        return False


def create_mock_data(output_dir: Path) -> bool:
    """Create mock data for development/testing."""
    print("  Creating mock data for development...")
    
    mock_geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "Mock data for development",
            "version": "MOCK",
            "attribution": "Quelle: DWD, CatRaRE v2023.01 (Mock)",
        },
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "ID": "MOCK001",
                    "DATUM": 20230715,
                    "ANFANG": "1400",
                    "ENDE": "1800",
                    "DAUER_H": 4,
                    "N_MAX": 85.5,
                    "N_SUMME": 120.3,
                    "WARNSTUFE": 3,
                    "FLAECHE_KM2": 250.5
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [10.0, 51.0], [10.5, 51.0], [10.5, 51.5], [10.0, 51.5], [10.0, 51.0]
                    ]]
                }
            },
            {
                "type": "Feature",
                "properties": {
                    "ID": "MOCK002",
                    "DATUM": 20220621,
                    "ANFANG": "1600",
                    "ENDE": "2100",
                    "DAUER_H": 5,
                    "N_MAX": 92.1,
                    "N_SUMME": 145.8,
                    "WARNSTUFE": 4,
                    "FLAECHE_KM2": 180.2
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [8.5, 50.0], [9.0, 50.0], [9.0, 50.3], [8.5, 50.3], [8.5, 50.0]
                    ]]
                }
            },
            {
                "type": "Feature",
                "properties": {
                    "ID": "MOCK003",
                    "DATUM": 20210814,
                    "ANFANG": "0200",
                    "ENDE": "0800",
                    "DAUER_H": 6,
                    "N_MAX": 110.0,
                    "N_SUMME": 180.5,
                    "WARNSTUFE": 4,
                    "FLAECHE_KM2": 320.0
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [6.8, 50.5], [7.2, 50.5], [7.2, 50.8], [6.8, 50.8], [6.8, 50.5]
                    ]]
                }
            }
        ]
    }
    
    # Save GeoJSON
    geojson_path = output_dir / "catrare_recent.json"
    with open(geojson_path, 'w', encoding='utf-8') as f:
        json.dump(mock_geojson, f, indent=2, ensure_ascii=False)
    print(f"  ✓ Created mock GeoJSON: {geojson_path.name}")
    
    # Try to create PMTiles from mock data
    deps = check_dependencies()
    if deps["tippecanoe"]:
        pmtiles_path = output_dir / "catrare.pmtiles"
        if convert_to_pmtiles(geojson_path, pmtiles_path):
            print(f"  ✓ Created mock PMTiles: {pmtiles_path.name}")
    else:
        print("  ⚠ tippecanoe not found, skipping PMTiles generation")
        print("    Install with: brew install tippecanoe (macOS)")
    
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Prepare CatRaRE data as PMTiles for serverless vector tile serving"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./data/catrare"),
        help="Output directory (default: ./data/catrare)"
    )
    parser.add_argument(
        "--years",
        type=int,
        default=YEARS_TO_KEEP,
        help=f"Number of recent years to include (default: {YEARS_TO_KEEP})"
    )
    parser.add_argument(
        "--mock",
        action="store_true",
        help="Create mock data for development without downloading"
    )
    parser.add_argument(
        "--geojson-only",
        action="store_true",
        help="Only create GeoJSON, skip PMTiles (if tippecanoe unavailable)"
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Force download even if output exists"
    )
    
    args = parser.parse_args()
    
    print("=" * 70)
    print("CatRaRE Data Preparation (PMTiles Virtual Vector Tiling)")
    print("=" * 70)
    print()
    print("Output format: PMTiles (serverless vector tiles)")
    print("  - Single archive file with all zoom levels (z4-z12)")
    print("  - HTTP Range Requests enable efficient streaming")
    print("  - No tile server required - works with static hosting")
    print()
    
    # Check dependencies
    print("Checking dependencies...")
    deps = check_dependencies()
    
    if not deps["ogr2ogr"]:
        print("\n✗ ERROR: ogr2ogr (GDAL) not found!")
        print("  Install with: brew install gdal (macOS) or apt install gdal-bin (Linux)")
        if not args.mock:
            sys.exit(1)
    else:
        print("  ✓ ogr2ogr available")
    
    if not deps["tippecanoe"]:
        print("  ⚠ tippecanoe not found - PMTiles generation will be skipped")
        print("    Install with: brew install tippecanoe (macOS)")
        print("    Or: https://github.com/felt/tippecanoe#installation")
        if not args.geojson_only and not args.mock:
            print("\n    Use --geojson-only to proceed without PMTiles")
    else:
        print("  ✓ tippecanoe available")
    
    if deps["pmtiles"]:
        print("  ✓ pmtiles CLI available (for validation)")
    
    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n✓ Output directory: {args.output_dir.absolute()}")
    
    pmtiles_path = args.output_dir / "catrare.pmtiles"
    geojson_path = args.output_dir / "catrare_recent.json"
    
    # Check if output exists
    if pmtiles_path.exists() and not args.force_download and not args.mock:
        print(f"✓ Output already exists: {pmtiles_path}")
        print("  Use --force-download to regenerate")
        return
    
    # Mock mode for development
    if args.mock:
        create_mock_data(args.output_dir)
        return
    
    # Calculate min year
    min_year = datetime.now().year - args.years
    print(f"✓ Filtering events from {min_year} onwards ({args.years} years)")
    
    # Find download URL
    print("\nSearching for CatRaRE data...")
    download_url = find_catrare_download_url()
    
    if not download_url:
        print("  ⚠ Could not find CatRaRE download URL")
        print(f"  Please check: {CATRARE_BASE_URL}")
        print("\n  Creating mock data instead...")
        create_mock_data(args.output_dir)
        return
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        # Download
        zip_path = temp_path / "catrare.zip"
        if not download_file(download_url, zip_path):
            print("\n  Download failed. Creating mock data...")
            create_mock_data(args.output_dir)
            return
        
        # Extract
        print("\nExtracting shapefile...")
        shp_path = extract_shapefile(zip_path, temp_path)
        if not shp_path:
            print("\n  Extraction failed. Creating mock data...")
            create_mock_data(args.output_dir)
            return
        
        # Convert to GeoJSON
        print("\nConverting to GeoJSON...")
        intermediate_json = temp_path / "intermediate.json"
        if not filter_and_convert_to_geojson(shp_path, intermediate_json, min_year):
            print("\n  Conversion failed. Creating mock data...")
            create_mock_data(args.output_dir)
            return
        
        # Copy GeoJSON to output (as fallback)
        import shutil
        shutil.copy(intermediate_json, geojson_path)
        print(f"  ✓ Saved GeoJSON fallback: {geojson_path.name}")
        
        # Convert to PMTiles
        if deps["tippecanoe"] and not args.geojson_only:
            print("\nGenerating PMTiles...")
            if not convert_to_pmtiles(intermediate_json, pmtiles_path):
                print("  ⚠ PMTiles generation failed, GeoJSON fallback available")
        else:
            print("\n⚠ Skipping PMTiles generation (tippecanoe not available)")
    
    print("\n" + "=" * 70)
    print("COMPLETE")
    print()
    if pmtiles_path.exists():
        print(f"  PMTiles: {pmtiles_path.absolute()}")
    print(f"  GeoJSON: {geojson_path.absolute()}")
    print()
    print("Next steps:")
    print("  1. Upload files to Supabase Storage bucket 'risk-layers/catrare/'")
    print("  2. Browser will stream vector tiles via HTTP Range Requests")
    print("=" * 70)


if __name__ == "__main__":
    main()
