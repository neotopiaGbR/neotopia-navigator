// Standard WGS84 Bounds: [minLon, minLat, maxLon, maxLat]
export const GERMANY_BBOX: [number, number, number, number] = [5.0, 47.0, 16.0, 56.0];

export function isValidWGS84Bounds(bounds: unknown): bounds is [number, number, number, number] {
  if (!Array.isArray(bounds) || bounds.length !== 4) return false;
  const [w, s, e, n] = bounds;
  
  // Check for NaN
  if (!Number.isFinite(w) || !Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(n)) return false;

  // STRICT CHECK: Are we on Earth?
  // Lat must be -90 to 90. Lon -180 to 180.
  // Common error: Swapping Lat/Lon puts Lat > 90 (invalid) or Lon < 40 (valid but wrong place)
  
  const validLat = s >= -90 && n <= 90 && s < n;
  const validLon = w >= -180 && e <= 180; // w < e is usually true but dateline crossing exists

  if (!validLat) {
    console.warn('[BoundsValidation] Invalid Latitude range (Is it Lat/Lon swapped?):', s, n);
    return false;
  }
  
  return validLat && validLon;
}

export function boundsIntersect(b1: [number, number, number, number], b2: [number, number, number, number]): boolean {
    return !(b1[2] < b2[0] || b1[0] > b2[2] || b1[3] < b2[1] || b1[1] > b2[3]);
}
