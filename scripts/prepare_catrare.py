#!/usr/bin/env python3
"""
CatRaRE (Catalogue of Radar-based Heavy Rainfall Events) Data Preparation Script

This script downloads and processes the CatRaRE dataset from DWD,
which catalogs historical heavy rainfall events across Germany.

DEPENDENCIES:
- Python 3.9+
- GDAL (with ogr2ogr): `brew install gdal` or `apt install gdal-bin`
- requests: `pip install requests`
- geopandas (optional, for advanced filtering): `pip install geopandas`

SOURCE:
- DWD CDC: https://opendata.dwd.de/climate_environment/CDC/grids_germany/hourly/radolan/CatRaRE/

OUTPUT:
- Optimized GeoJSON with filtered events from the last 10 years
- Filename: catrare_recent.json

USAGE:
    python scripts/prepare_catrare.py --output-dir ./data/catrare

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
from datetime import datetime, timedelta
from typing import Optional

try:
    import requests
except ImportError:
    print("ERROR: requests library required. Install with: pip install requests")
    sys.exit(1)


# === CONFIGURATION ===

# CatRaRE data URL (versioned, check for updates periodically)
# Pattern: CatRaRE_W{warn_level}_Eta_v{year}.{version}/
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


def check_ogr_installed() -> bool:
    """Verify ogr2ogr is available."""
    try:
        result = subprocess.run(
            ["ogr2ogr", "--version"],
            capture_output=True,
            text=True,
            check=False
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False


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
    """
    Attempt to find the actual download URL for CatRaRE.
    The DWD file structure may vary, so we try common patterns.
    """
    # Try direct ZIP download
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
            # List contents
            names = zf.namelist()
            print(f"  Archive contains {len(names)} files")
            
            # Find .shp file
            shp_files = [n for n in names if n.endswith('.shp')]
            if not shp_files:
                print("  ✗ No .shp file found in archive")
                return None
            
            # Extract all (shapefile needs .dbf, .shx, .prj etc.)
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
    """
    Convert Shapefile to GeoJSON with filtering.
    Uses ogr2ogr for robust conversion.
    """
    
    # Build WHERE clause for date filtering
    # DATUM format is typically YYYYMMDD as integer
    min_date = min_year * 10000 + 101  # e.g., 20140101
    
    try:
        cmd = [
            "ogr2ogr",
            "-f", "GeoJSON",
            "-t_srs", "EPSG:4326",  # Ensure WGS84
            "-where", f"DATUM >= {min_date}",
            "-select", ",".join([c for c in KEEP_COLUMNS if c != "geometry"]),
            "-lco", "COORDINATE_PRECISION=5",  # Reduce precision for smaller files
            str(output_json),
            str(input_shp)
        ]
        
        print(f"  Running: ogr2ogr with date filter >= {min_date}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        
        if result.returncode != 0:
            print(f"  ✗ ogr2ogr failed: {result.stderr}")
            return False
        
        # Verify output
        if not output_json.exists():
            print("  ✗ Output file not created")
            return False
        
        size_mb = output_json.stat().st_size / 1024 / 1024
        print(f"  ✓ Created: {output_json.name} ({size_mb:.1f} MB)")
        
        # Count features
        with open(output_json, 'r', encoding='utf-8') as f:
            data = json.load(f)
            feature_count = len(data.get('features', []))
            print(f"  ✓ Contains {feature_count} events from {min_year} onwards")
        
        return True
        
    except Exception as e:
        print(f"  ✗ Conversion failed: {e}")
        return False


def optimize_geojson(input_path: Path, output_path: Path) -> bool:
    """
    Optimize GeoJSON for web delivery:
    - Remove unnecessary whitespace
    - Round coordinates to 5 decimal places
    - Add metadata header
    """
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Add metadata
        data['metadata'] = {
            'source': 'DWD CatRaRE (Catalogue of Radar-based Heavy Rainfall Events)',
            'version': CATRARE_VERSION,
            'attribution': 'Quelle: DWD, CatRaRE v2023.01',
            'license': 'CC BY 4.0',
            'processed': datetime.now().isoformat(),
            'url': 'https://opendata.dwd.de/climate_environment/CDC/grids_germany/hourly/radolan/CatRaRE/'
        }
        
        # Write optimized (compact) JSON
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        
        original_size = input_path.stat().st_size / 1024
        optimized_size = output_path.stat().st_size / 1024
        reduction = (1 - optimized_size / original_size) * 100
        
        print(f"  ✓ Optimized: {original_size:.1f} KB → {optimized_size:.1f} KB ({reduction:.1f}% reduction)")
        return True
        
    except Exception as e:
        print(f"  ✗ Optimization failed: {e}")
        return False


def create_mock_data(output_path: Path) -> bool:
    """
    Create mock CatRaRE data for development/testing when download fails.
    """
    print("  Creating mock data for development...")
    
    mock_data = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "Mock data for development",
            "version": "MOCK",
            "attribution": "Quelle: DWD, CatRaRE v2023.01 (Mock)",
            "note": "This is placeholder data. Run with --force-download for real data."
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
                    "coordinates": [[[
                        [10.0, 51.0], [10.5, 51.0], [10.5, 51.5], [10.0, 51.5], [10.0, 51.0]
                    ]]]
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
                    "WARNSTUFE": 3,
                    "FLAECHE_KM2": 180.2
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[
                        [8.5, 50.0], [9.0, 50.0], [9.0, 50.3], [8.5, 50.3], [8.5, 50.0]
                    ]]]
                }
            }
        ]
    }
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(mock_data, f, indent=2, ensure_ascii=False)
    
    print(f"  ✓ Created mock data: {output_path.name}")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Prepare CatRaRE historical heavy rainfall events for visualization"
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
        "--force-download",
        action="store_true",
        help="Force download even if output exists"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("CatRaRE Data Preparation")
    print("=" * 60)
    
    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_file = args.output_dir / "catrare_recent.json"
    
    # Check if output exists
    if output_file.exists() and not args.force_download and not args.mock:
        print(f"✓ Output already exists: {output_file}")
        print("  Use --force-download to regenerate")
        return
    
    # Mock mode for development
    if args.mock:
        create_mock_data(output_file)
        return
    
    # Check GDAL
    if not check_ogr_installed():
        print("\n✗ ERROR: ogr2ogr (GDAL) not found!")
        print("  Install with: brew install gdal (macOS) or apt install gdal-bin (Linux)")
        print("  Or use --mock to create mock data for development")
        sys.exit(1)
    
    print("✓ GDAL tools available")
    
    # Calculate min year
    min_year = datetime.now().year - args.years
    print(f"✓ Filtering events from {min_year} onwards ({args.years} years)")
    
    # Find download URL
    print("\nSearching for CatRaRE data...")
    download_url = find_catrare_download_url()
    
    if not download_url:
        print("  ⚠ Could not find CatRaRE download URL")
        print("  The DWD file structure may have changed.")
        print(f"  Please check: {CATRARE_BASE_URL}")
        print("\n  Creating mock data instead...")
        create_mock_data(output_file)
        return
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        # Download
        zip_path = temp_path / "catrare.zip"
        if not download_file(download_url, zip_path):
            print("\n  Download failed. Creating mock data...")
            create_mock_data(output_file)
            return
        
        # Extract
        print("\nExtracting shapefile...")
        shp_path = extract_shapefile(zip_path, temp_path)
        if not shp_path:
            print("\n  Extraction failed. Creating mock data...")
            create_mock_data(output_file)
            return
        
        # Convert with filtering
        print("\nConverting to GeoJSON...")
        intermediate_json = temp_path / "intermediate.json"
        if not filter_and_convert_to_geojson(shp_path, intermediate_json, min_year):
            print("\n  Conversion failed. Creating mock data...")
            create_mock_data(output_file)
            return
        
        # Optimize
        print("\nOptimizing for web delivery...")
        if not optimize_geojson(intermediate_json, output_file):
            # Fall back to unoptimized
            import shutil
            shutil.copy(intermediate_json, output_file)
    
    print("\n" + "=" * 60)
    print(f"COMPLETE: {output_file.absolute()}")
    print("=" * 60)


if __name__ == "__main__":
    main()
