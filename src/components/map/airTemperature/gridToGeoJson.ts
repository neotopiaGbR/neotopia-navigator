import type { FeatureCollection, Point } from 'geojson';

export interface GridPoint {
  lat: number;
  lon: number;
  value: number;
}

export function gridToGeoJson(grid: GridPoint[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: grid.map((point, index) => ({
      type: 'Feature',
      id: index,
      geometry: {
        type: 'Point',
        // CRITICAL FIX: GeoJSON requires [Longitude, Latitude] (X, Y)
        // If this was [lat, lon], data would appear in Somalia/Indian Ocean
        coordinates: [point.lon, point.lat], 
      },
      properties: {
        value: point.value,
      },
    })),
  };
}
