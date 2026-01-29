// Strict WGS84 Validation
export const GERMANY_BBOX: [number, number, number, number] = [5.0, 47.0, 16.0, 56.0];

export function isValidWGS84Bounds(bounds: unknown): bounds is [number, number, number, number] {
  if (!Array.isArray(bounds) || bounds.length !== 4) return false;
  
  const [w, s, e, n] = bounds;
  
  // Check finiteness
  if (![w, s, e, n].every(Number.isFinite)) return false;

  // Logic checks
  if (s > n) return false; // South cannot be north of North
  if (s < -90 || n > 90) return false; // Latitude limits
  if (w < -180 || e > 180) return false; // Longitude limits

  return true;
}

export function boundsIntersect(b1: number[], b2: number[]): boolean {
  return !(b1[2] < b2[0] || b1[0] > b2[2] || b1[3] < b2[1] || b1[1] > b2[3]);
}
