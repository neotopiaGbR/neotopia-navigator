import type { FeatureCollection, Polygon } from 'geojson';

export interface GridPoint {
  lat: number;
  lon: number;
  value: number;
}

/**
 * Approximate offset for 1km in degrees at German latitudes (~50°N)
 * - Latitude: 1 degree ≈ 111km → 1km ≈ 0.009°
 * - Longitude: 1 degree ≈ 71km at 50°N → 1km ≈ 0.014°
 * We use half-cell offsets to create squares centered on the point
 */
const LAT_OFFSET_1KM = 0.0045; // ~500m in latitude
const LON_OFFSET_1KM = 0.007;  // ~500m in longitude at ~50°N

/**
 * Convert grid points to GeoJSON polygons (1km squares).
 * Each point becomes a square polygon centered on lat/lon.
 */
export function gridToGeoJson(grid: GridPoint[]): FeatureCollection<Polygon> {
  if (!Array.isArray(grid)) return { type: 'FeatureCollection', features: [] };

  return {
    type: 'FeatureCollection',
    features: grid.map((point, index) => {
      const { lat, lon, value } = point;
      
      // Create a square polygon centered on the point
      // Coordinates go counter-clockwise starting from SW corner
      const sw: [number, number] = [lon - LON_OFFSET_1KM, lat - LAT_OFFSET_1KM];
      const se: [number, number] = [lon + LON_OFFSET_1KM, lat - LAT_OFFSET_1KM];
      const ne: [number, number] = [lon + LON_OFFSET_1KM, lat + LAT_OFFSET_1KM];
      const nw: [number, number] = [lon - LON_OFFSET_1KM, lat + LAT_OFFSET_1KM];
      
      return {
        type: 'Feature' as const,
        id: index,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[sw, se, ne, nw, sw]], // Closed ring
        },
        properties: {
          value,
        },
      };
    }),
  };
}
