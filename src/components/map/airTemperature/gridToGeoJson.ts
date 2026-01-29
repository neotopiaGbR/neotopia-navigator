import type { FeatureCollection, Point } from 'geojson';

export interface GridPoint {
  lat: number;
  lon: number;
  value: number;
}

export function gridToGeoJson(grid: GridPoint[]): FeatureCollection<Point> {
  if (!Array.isArray(grid)) return { type: 'FeatureCollection', features: [] };

  return {
    type: 'FeatureCollection',
    features: grid.map((point, index) => ({
      type: 'Feature',
      id: index,
      geometry: {
        type: 'Point',
        // ARCHITECT FIX: GeoJSON is ALWAYS [Lon, Lat] (X, Y).
        // Never swap this order.
        coordinates: [point.lon, point.lat], 
      },
      properties: {
        value: point.value,
      },
    })),
  };
}
