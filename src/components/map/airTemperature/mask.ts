import type { MultiPolygon, Ring } from './types';

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  // Ray casting algorithm
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, polygon: Ring[]): boolean {
  // polygon[0] = outer, polygon[1..] = holes
  if (polygon.length === 0) return false;
  if (!pointInRing(lon, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lon, lat, polygon[i])) return false;
  }
  return true;
}

export function pointInMultiPolygon(lon: number, lat: number, multi: MultiPolygon): boolean {
  for (const poly of multi) {
    if (pointInPolygon(lon, lat, poly)) return true;
  }
  return false;
}
