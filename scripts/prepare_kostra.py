#!/usr/bin/env python3
"""
KOSTRA-DWD-2020 Data Preparation Script

This script downloads and processes KOSTRA-DWD-2020 precipitation intensity data
for heavy rain risk visualization. Converts DWD ASCII Grid files to Cloud Optimized
GeoTIFFs (COGs) for efficient client-side rendering.

DEPENDENCIES:
- Python 3.9+
- GDAL (with gdal_translate): `brew install gdal` or `apt install gdal-bin`
- requests: `pip install requests`

SOURCE:
- DWD Open Data: https://opendata.dwd.de/climate_environment/CDC/grids_germany/return_periods/precipitation/KOSTRA/

OUTPUT:
- Cloud Optimized GeoTIFFs in EPSG:4326 (WGS84) projection
- Naming: kostra_d{duration}_t{return_period}.tif

USAGE:
    python scripts/prepare_kostra.py --output-dir ./data/kostra

Author: Neotopia Navigator
License: MIT
"""

import os
import sys
import argparse
import tempfile
import subprocess
import gzip
import shutil
from pathlib import Path
from urllib.parse import urljoin

try:
    import requests
except ImportError:
    print("ERROR: requests library required. Install with: pip install requests")
    sys.exit(1)


# === CONFIGURATION ===

BASE_URL = "https://opendata.dwd.de/climate_environment/CDC/grids_germany/return_periods/precipitation/KOSTRA/KOSTRA_DWD_2020_v2021.01/"

# Selected scenarios for visualization
# Durations: 60 min (1h), 720 min (12h), 1440 min (24h)
# Return periods: 10 years (T10), 100 years (T100)
DURATIONS = {
    "60min": "060",    # 1 hour
    "12h": "720",      # 12 hours
    "24h": "1440",     # 24 hours
}

RETURN_PERIODS = {
    "10a": "010",      # 10 years
    "100a": "100",     # 100 years
}

# KOSTRA file naming pattern: hN_D{duration}m_T{period}a.asc.gz
# Example: hN_D060m_T010a.asc.gz


def check_gdal_installed() -> bool:
    """Verify GDAL tools are available."""
    try:
        result = subprocess.run(
            ["gdal_translate", "--version"],
            capture_output=True,
            text=True,
            check=False
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False


def download_file(url: str, target_path: Path) -> bool:
    """Download a file from URL to target path."""
    print(f"  Downloading: {url}")
    try:
        response = requests.get(url, stream=True, timeout=120)
        response.raise_for_status()
        
        with open(target_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        print(f"  ✓ Downloaded: {target_path.name} ({target_path.stat().st_size / 1024:.1f} KB)")
        return True
    except requests.RequestException as e:
        print(f"  ✗ Download failed: {e}")
        return False


def decompress_gzip(gz_path: Path, output_path: Path) -> bool:
    """Decompress a .gz file."""
    try:
        with gzip.open(gz_path, 'rb') as f_in:
            with open(output_path, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
        print(f"  ✓ Decompressed: {output_path.name}")
        return True
    except Exception as e:
        print(f"  ✗ Decompression failed: {e}")
        return False


def convert_to_cog(
    input_path: Path,
    output_path: Path,
    source_srs: str = "EPSG:31467",  # Gauss-Krüger Zone 3 (common for DWD)
    target_srs: str = "EPSG:4326"
) -> bool:
    """
    Convert ASCII Grid to Cloud Optimized GeoTIFF with reprojection.
    
    KOSTRA data is typically in EPSG:31467 (Gauss-Krüger Zone 3) or EPSG:3035.
    We reproject to WGS84 for web map compatibility.
    """
    try:
        # Step 1: Convert to intermediate GeoTIFF with proper CRS assignment
        with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp:
            intermediate_path = Path(tmp.name)
        
        # Assign source CRS and convert to GeoTIFF
        cmd_translate = [
            "gdal_translate",
            "-of", "GTiff",
            "-a_srs", source_srs,
            "-a_nodata", "-999",  # KOSTRA uses -999 for nodata
            str(input_path),
            str(intermediate_path)
        ]
        
        result = subprocess.run(cmd_translate, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            print(f"  ✗ gdal_translate failed: {result.stderr}")
            return False
        
        # Step 2: Warp to target CRS and create COG
        cmd_warp = [
            "gdalwarp",
            "-s_srs", source_srs,
            "-t_srs", target_srs,
            "-r", "bilinear",
            "-of", "COG",
            "-co", "COMPRESS=LZW",
            "-co", "PREDICTOR=2",
            "-co", "BIGTIFF=IF_SAFER",
            "-overwrite",
            str(intermediate_path),
            str(output_path)
        ]
        
        result = subprocess.run(cmd_warp, capture_output=True, text=True, check=False)
        
        # Cleanup intermediate file
        intermediate_path.unlink(missing_ok=True)
        
        if result.returncode != 0:
            print(f"  ✗ gdalwarp failed: {result.stderr}")
            return False
        
        print(f"  ✓ Created COG: {output_path.name} ({output_path.stat().st_size / 1024:.1f} KB)")
        return True
        
    except Exception as e:
        print(f"  ✗ Conversion failed: {e}")
        return False


def process_scenario(
    duration_key: str,
    duration_code: str,
    period_key: str,
    period_code: str,
    output_dir: Path,
    temp_dir: Path
) -> bool:
    """Download and process a single KOSTRA scenario."""
    
    # Construct filename: hN_D{duration}m_T{period}a.asc.gz
    filename = f"hN_D{duration_code}m_T{period_code}a.asc.gz"
    url = urljoin(BASE_URL, filename)
    
    output_name = f"kostra_d{duration_key}_t{period_key}.tif"
    output_path = output_dir / output_name
    
    print(f"\n[{duration_key} / {period_key}] Processing {filename}...")
    
    # Download compressed file
    gz_path = temp_dir / filename
    if not download_file(url, gz_path):
        return False
    
    # Decompress
    asc_path = temp_dir / filename.replace('.gz', '')
    if not decompress_gzip(gz_path, asc_path):
        return False
    
    # Convert to COG
    if not convert_to_cog(asc_path, output_path):
        return False
    
    # Cleanup temp files
    gz_path.unlink(missing_ok=True)
    asc_path.unlink(missing_ok=True)
    
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Prepare KOSTRA-DWD-2020 precipitation data for heavy rain risk visualization"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./data/kostra"),
        help="Output directory for COG files (default: ./data/kostra)"
    )
    parser.add_argument(
        "--source-srs",
        type=str,
        default="EPSG:31467",
        help="Source CRS for KOSTRA data (default: EPSG:31467 Gauss-Krüger Zone 3)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without downloading"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("KOSTRA-DWD-2020 Data Preparation")
    print("=" * 60)
    
    # Check GDAL
    if not check_gdal_installed():
        print("\n✗ ERROR: GDAL tools not found!")
        print("  Install with: brew install gdal (macOS) or apt install gdal-bin (Linux)")
        sys.exit(1)
    
    print("✓ GDAL tools available")
    
    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)
    print(f"✓ Output directory: {args.output_dir.absolute()}")
    
    if args.dry_run:
        print("\n[DRY RUN] Would download the following scenarios:")
        for d_key, d_code in DURATIONS.items():
            for p_key, p_code in RETURN_PERIODS.items():
                filename = f"hN_D{d_code}m_T{p_code}a.asc.gz"
                output = f"kostra_d{d_key}_t{p_key}.tif"
                print(f"  {filename} → {output}")
        return
    
    # Process all scenarios
    success_count = 0
    total_count = len(DURATIONS) * len(RETURN_PERIODS)
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        for d_key, d_code in DURATIONS.items():
            for p_key, p_code in RETURN_PERIODS.items():
                if process_scenario(d_key, d_code, p_key, p_code, args.output_dir, temp_path):
                    success_count += 1
    
    print("\n" + "=" * 60)
    print(f"COMPLETE: {success_count}/{total_count} scenarios processed")
    print(f"Output: {args.output_dir.absolute()}")
    print("=" * 60)
    
    if success_count < total_count:
        print("\n⚠ WARNING: Some scenarios failed. Check logs above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
