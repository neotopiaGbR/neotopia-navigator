import type { FeatureCollection, Polygon } from 'geojson';

export interface GridPoint {
  lat: number;
  lon: number;
  value: number;
}

/**
 * Convert meters to approximate degrees at a given latitude.
 * - Latitude: 1 degree ≈ 111,320m
 * - Longitude: varies by latitude, 1 degree ≈ 111,320 * cos(lat)
 */
function metersToDegreesLat(meters: number): number {
  return meters / 111320;
}

function metersToDegreesLon(meters: number, latDeg: number): number {
  const cosLat = Math.cos((latDeg * Math.PI) / 180);
  return meters / (111320 * cosLat);
}

/**
 * Convert grid points to GeoJSON polygons (square cells).
 * Each point becomes a square polygon centered on lat/lon.
 * 
 * @param grid Array of grid points with lat, lon, value
 * @param cellSizeMeters Size of each cell in meters (default 3000m = 3km for sample=3)
 */
export function gridToGeoJson(
  grid: GridPoint[], 
  cellSizeMeters: number = 3000
): FeatureCollection<Polygon> {
  if (!Array.isArray(grid) || grid.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  // Half-cell offset for centering
  const halfCellMeters = cellSizeMeters / 2;

  return {
    type: 'FeatureCollection',
    features: grid.map((point, index) => {
      const { lat, lon, value } = point;
      
      // Calculate offsets in degrees based on cell size and latitude
      const latOffset = metersToDegreesLat(halfCellMeters);
      const lonOffset = metersToDegreesLon(halfCellMeters, lat);
      
      // Create a square polygon centered on the point
      // Coordinates go counter-clockwise starting from SW corner
      const sw: [number, number] = [lon - lonOffset, lat - latOffset];
      const se: [number, number] = [lon + lonOffset, lat - latOffset];
      const ne: [number, number] = [lon + lonOffset, lat + latOffset];
      const nw: [number, number] = [lon - lonOffset, lat + latOffset];
      
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
