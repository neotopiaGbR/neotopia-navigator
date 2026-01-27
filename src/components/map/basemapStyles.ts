import type { StyleSpecification } from 'maplibre-gl';
import { BasemapType } from './MapLayersContext';

// Dark Carto basemap (default)
export const DARK_STYLE: StyleSpecification = {
  version: 8,
  name: 'Dark',
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: 'carto-dark-layer',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

// Satellite basemap using ESRI World Imagery (free tier)
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Satellite',
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '&copy; Esri, Maxar, Earthstar Geographics',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'esri-satellite-layer',
      type: 'raster',
      source: 'esri-satellite',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

// Terrain basemap using Stadia Outdoors
export const TERRAIN_STYLE: StyleSpecification = {
  version: 8,
  name: 'Terrain',
  sources: {
    'stadia-terrain': {
      type: 'raster',
      tiles: [
        'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://stamen.com/">Stamen</a>',
    },
  },
  layers: [
    {
      id: 'stadia-terrain-layer',
      type: 'raster',
      source: 'stadia-terrain',
      minzoom: 0,
      maxzoom: 18,
    },
  ],
};

export function getBasemapStyle(basemap: BasemapType): StyleSpecification {
  switch (basemap) {
    case 'satellite':
      return SATELLITE_STYLE;
    case 'terrain':
      return TERRAIN_STYLE;
    case 'map':
    default:
      return DARK_STYLE;
  }
}

// WMS layer configuration for flood risk
export const FLOOD_RISK_WMS = {
  // European Flood Awareness System (EFAS) from Copernicus
  efas: {
    url: 'https://maps.copernicus.eu/services/wms',
    layers: 'efas:efas_hazard',
    attribution: 'Copernicus Emergency Management Service',
  },
  // JRC Global Surface Water (alternative)
  jrc_gsw: {
    url: 'https://global-surface-water.appspot.com/tiles/2021/',
    type: 'xyz' as const,
    attribution: 'JRC/Google Global Surface Water',
  },
};

// ECOSTRESS colormap for LST (Land Surface Temperature)
export const ECOSTRESS_COLORMAP = {
  // Kelvin to Celsius: K - 273.15
  // Range: 15°C (288K) to 55°C (328K)
  stops: [
    [288, '#313695'], // < 15°C - deep blue
    [293, '#4575b4'], // 20°C - blue
    [298, '#74add1'], // 25°C - light blue
    [303, '#abd9e9'], // 30°C - pale blue
    [308, '#e0f3f8'], // 35°C - very pale
    [313, '#fee090'], // 40°C - yellow
    [318, '#fdae61'], // 45°C - orange
    [323, '#f46d43'], // 50°C - red-orange
    [328, '#d73027'], // 55°C - red
    [333, '#a50026'], // > 60°C - dark red
  ] as [number, string][],
  noDataValue: 0,
  scaleFactor: 0.02, // ECOSTRESS LST scale factor
};
