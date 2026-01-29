/**
 * Shared Geometry Utilities
 * 
 * Provides consistent geometry processing functions used across the application.
 * Eliminates duplicated logic in hooks and components.
 */

/**
 * Extract centroid coordinates from a GeoJSON geometry
 */
export function getCentroidFromGeom(geom: GeoJSON.Geometry): { lat: number; lon: number } | null {
  try {
    if (geom.type === 'Point') {
      return { lon: geom.coordinates[0], lat: geom.coordinates[1] };
    }

    if (geom.type === 'Polygon') {
      const coords = geom.coordinates[0];
      if (!coords || coords.length === 0) return null;
      const sumLon = coords.reduce((sum, c) => sum + c[0], 0);
      const sumLat = coords.reduce((sum, c) => sum + c[1], 0);
      return { lon: sumLon / coords.length, lat: sumLat / coords.length };
    }

    if (geom.type === 'MultiPolygon') {
      let totalLon = 0;
      let totalLat = 0;
      let count = 0;
      for (const polygon of geom.coordinates) {
        for (const coord of polygon[0]) {
          totalLon += coord[0];
          totalLat += coord[1];
          count++;
        }
      }
      if (count === 0) return null;
      return { lon: totalLon / count, lat: totalLat / count };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract bounding box from a GeoJSON geometry
 * Returns [west, south, east, north] (minLon, minLat, maxLon, maxLat)
 */
export function getBboxFromGeom(geom: GeoJSON.Geometry): [number, number, number, number] | null {
  try {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    function processCoords(coords: number[]) {
      if (coords[0] < minLon) minLon = coords[0];
      if (coords[0] > maxLon) maxLon = coords[0];
      if (coords[1] < minLat) minLat = coords[1];
      if (coords[1] > maxLat) maxLat = coords[1];
    }

    if (geom.type === 'Point') {
      processCoords(geom.coordinates);
    } else if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) {
        for (const coord of ring) {
          processCoords(coord);
        }
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            processCoords(coord);
          }
        }
      }
    } else if (geom.type === 'LineString') {
      for (const coord of geom.coordinates) {
        processCoords(coord);
      }
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        for (const coord of line) {
          processCoords(coord);
        }
      }
    } else if (geom.type === 'MultiPoint') {
      for (const coord of geom.coordinates) {
        processCoords(coord);
      }
    }

    if (minLon === Infinity) return null;
    return [minLon, minLat, maxLon, maxLat];
  } catch {
    return null;
  }
}

/**
 * Check if two bounding boxes intersect
 */
export function bboxIntersects(
  bbox1: [number, number, number, number],
  bbox2: [number, number, number, number]
): boolean {
  return !(
    bbox1[2] < bbox2[0] || // bbox1 right < bbox2 left
    bbox1[0] > bbox2[2] || // bbox1 left > bbox2 right
    bbox1[3] < bbox2[1] || // bbox1 top < bbox2 bottom
    bbox1[1] > bbox2[3]    // bbox1 bottom > bbox2 top
  );
}

/**
 * Check if a point is inside a bounding box
 */
export function pointInBbox(
  lon: number,
  lat: number,
  bbox: [number, number, number, number]
): boolean {
  const [west, south, east, north] = bbox;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/**
 * Expand a bounding box by a given factor (e.g., 1.1 = 10% larger)
 */
export function expandBbox(
  bbox: [number, number, number, number],
  factor: number
): [number, number, number, number] {
  const [west, south, east, north] = bbox;
  const width = east - west;
  const height = north - south;
  const dw = (width * (factor - 1)) / 2;
  const dh = (height * (factor - 1)) / 2;
  return [west - dw, south - dh, east + dw, north + dh];
}

/**
 * Calculate the area of a bounding box in square degrees
 * (approximate, not accounting for projection)
 */
export function bboxArea(bbox: [number, number, number, number]): number {
  const [west, south, east, north] = bbox;
  return Math.abs((east - west) * (north - south));
}

/**
 * Get a date string for N days ago (YYYY-MM-DD format)
 */
export function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

/**
 * Development-only logging helper
 */
export function devLog(tag: string, ...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.log(`[${tag}]`, ...args);
  }
}

/**
 * Development-only warning helper
 */
export function devWarn(tag: string, ...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.warn(`[${tag}]`, ...args);
  }
}
