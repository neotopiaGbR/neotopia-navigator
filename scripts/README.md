# Data Preparation Scripts

Diese Skripte bereiten Geodaten für die Neotopia Navigator Anwendung auf.

## 🚀 Virtual Tiling Architecture

Die Skripte erzeugen **Cloud-Native Formate**, die HTTP Range Requests unterstützen. Der Browser lädt nur die sichtbaren Tiles, nicht die gesamte Datei.

| Format | Typ | Beschreibung |
|--------|-----|--------------|
| **COG** (Cloud Optimized GeoTIFF) | Raster | Intern gekachelte TIFFs mit Überblickspyramiden |
| **PMTiles** | Vektor | Einzelarchiv mit allen Vektorkacheln (z4-z12) |

## 📦 Abhängigkeiten

### Erforderlich

```bash
# macOS
brew install gdal           # GDAL 3.x für Raster-Konvertierung
brew install tippecanoe     # Für PMTiles-Generierung

# Linux (Ubuntu/Debian)
sudo apt install gdal-bin
# tippecanoe: https://github.com/felt/tippecanoe#installation

# Python
pip install requests
```

### Optional

```bash
npm install -g pmtiles      # PMTiles CLI für Validierung
```

## 📂 Skripte

### `prepare_kostra.py` - Starkregen-Potenzial (Raster)

Konvertiert KOSTRA-DWD-2020 ASCII-Grids in Cloud Optimized GeoTIFFs.

```bash
# Vollständige Verarbeitung
python scripts/prepare_kostra.py --output-dir ./data/kostra

# Vorschau (kein Download)
python scripts/prepare_kostra.py --dry-run
```

**Ausgabe:**
- `kostra_d60min_t10a.tif` - 1h Dauer, 10-Jahres-Wiederkehr
- `kostra_d60min_t100a.tif` - 1h Dauer, 100-Jahres-Wiederkehr
- `kostra_d12h_t10a.tif` etc.

**COG-Eigenschaften:**
- 256×256 interne Kacheln
- DEFLATE-Kompression
- Überblickspyramiden (2×, 4×, 8×, 16×)
- EPSG:4326 (WGS84)

### `prepare_catrare.py` - Historische Starkregenereignisse (Vektor)

Konvertiert CatRaRE Shapefiles in PMTiles.

```bash
# Vollständige Verarbeitung
python scripts/prepare_catrare.py --output-dir ./data/catrare

# Nur GeoJSON (wenn tippecanoe fehlt)
python scripts/prepare_catrare.py --geojson-only

# Mock-Daten für Entwicklung
python scripts/prepare_catrare.py --mock
```

**Ausgabe:**
- `catrare.pmtiles` - Vektorkacheln (z4-z12)
- `catrare_recent.json` - GeoJSON Fallback

**PMTiles-Eigenschaften:**
- Zoom-Level 4-12
- Layer: `catrare`
- Attribute: ID, DATUM, WARNSTUFE, N_MAX, etc.

## 🌐 Deployment

Nach der Generierung:

1. **Supabase Storage Bucket erstellen:**
   ```sql
   INSERT INTO storage.buckets (id, name, public)
   VALUES ('risk-layers', 'risk-layers', true);
   ```

2. **Dateien hochladen:**
   ```
   risk-layers/
   ├── kostra/
   │   ├── kostra_d60min_t10a.tif
   │   ├── kostra_d60min_t100a.tif
   │   └── ...
   └── catrare/
       ├── catrare.pmtiles
       └── catrare_recent.json  (Fallback)
   ```

3. **CORS-Konfiguration prüfen** (für Range Requests):
   - Supabase Storage unterstützt Range Requests standardmäßig

## 🔧 Troubleshooting

### "GDAL not found"
```bash
# macOS
brew install gdal

# Verify
gdalinfo --version
```

### "tippecanoe not found"
```bash
# macOS
brew install tippecanoe

# Linux: Build from source
git clone https://github.com/felt/tippecanoe.git
cd tippecanoe
make -j
sudo make install
```

### COG-Validierung
```bash
# Prüfe interne Struktur
gdalinfo -json data/kostra/kostra_d24h_t100a.tif | jq '.bands[0].block'
# Sollte [256, 256] zeigen
```

### PMTiles-Validierung
```bash
# Installiere CLI
npm install -g pmtiles

# Zeige Metadaten
pmtiles show data/catrare/catrare.pmtiles
```

## 📚 Datenquellen

| Datensatz | Quelle | Lizenz |
|-----------|--------|--------|
| KOSTRA-DWD-2020 | [DWD Open Data](https://opendata.dwd.de/climate_environment/CDC/grids_germany/return_periods/precipitation/KOSTRA/) | DL-DE 2.0 |
| CatRaRE | [DWD CDC](https://opendata.dwd.de/climate_environment/CDC/grids_germany/hourly/radolan/CatRaRE/) | CC BY 4.0 |
