/**
 * Bounds Validation Utilities
 * 
 * Centralized validation for WGS84 bounding boxes used across all map overlays.
 * Provides fail-fast assertions for CRS/bounds issues.
 */

export type WGS84Bounds = [number, number, number, number]; // [west, south, east, north]

/**
 * Germany bounding box (generous, includes buffer for edge cases)
 */
export const GERMANY_BBOX: WGS84Bounds = [5.0, 46.5, 16.0, 56.0];

/**
 * Central Europe bounding box (for broader coverage checks)
 */
export const CENTRAL_EUROPE_BBOX: WGS84Bounds = [2.0, 44.0, 20.0, 58.0];

/**
 * Validate that bounds are valid WGS84 coordinates
 */
export function isValidWGS84Bounds(bounds: unknown): bounds is WGS84Bounds {
  if (!Array.isArray(bounds) || bounds.length !== 4) return false;
  
  const [west, south, east, north] = bounds;
  
  // Check all values are finite numbers
  if (!Number.isFinite(west) || !Number.isFinite(south) || 
      !Number.isFinite(east) || !Number.isFinite(north)) {
    return false;
  }
  
  // Check valid WGS84 ranges
  if (west < -180 || east > 180 || south < -90 || north > 90) {
    return false;
  }
  
  // Check west < east and south < north
  if (west >= east || south >= north) {
    return false;
  }
  
  return true;
}

/**
 * Check if bounds intersect with a reference bbox
 */
export function boundsIntersect(
  bounds: WGS84Bounds, 
  reference: WGS84Bounds = GERMANY_BBOX
): boolean {
  const [west, south, east, north] = bounds;
  const [refWest, refSouth, refEast, refNorth] = reference;
  
  return !(
    east < refWest || 
    west > refEast || 
    north < refSouth || 
    south > refNorth
  );
}

/**
 * Calculate intersection area ratio (how much of reference is covered)
 */
export function calculateCoverageRatio(
  bounds: WGS84Bounds,
  reference: WGS84Bounds = GERMANY_BBOX
): number {
  const [west, south, east, north] = bounds;
  const [refWest, refSouth, refEast, refNorth] = reference;
  
  // Calculate intersection
  const intWest = Math.max(west, refWest);
  const intSouth = Math.max(south, refSouth);
  const intEast = Math.min(east, refEast);
  const intNorth = Math.min(north, refNorth);
  
  // No intersection
  if (intWest >= intEast || intSouth >= intNorth) {
    return 0;
  }
  
  const intersectionArea = (intEast - intWest) * (intNorth - intSouth);
  const referenceArea = (refEast - refWest) * (refNorth - refSouth);
  
  return referenceArea > 0 ? Math.min(1, intersectionArea / referenceArea) : 0;
}

/**
 * Validate bounds for Germany-specific data (DWD, etc.)
 * Throws if bounds are invalid or don't intersect Germany
 */
export function assertGermanyBounds(
  bounds: unknown,
  context: string = 'Data'
): asserts bounds is WGS84Bounds {
  if (!isValidWGS84Bounds(bounds)) {
    throw new Error(
      `[${context}] Invalid bounds format: ${JSON.stringify(bounds)}. ` +
      `Expected [west, south, east, north] in WGS84 degrees.`
    );
  }
  
  // Use generous Central Europe bbox to avoid rejecting valid grids with minor projection offsets
  if (!boundsIntersect(bounds, CENTRAL_EUROPE_BBOX)) {
    throw new Error(
      `[${context}] Bounds do not intersect Central Europe: ${JSON.stringify(bounds)}. ` +
      `This may indicate a CRS/projection mismatch.`
    );
  }
}

/**
 * Validate bounds for global data (ECOSTRESS, MODIS, etc.)
 * Just checks for valid WGS84 format without geographic constraints
 */
export function assertValidBounds(
  bounds: unknown,
  context: string = 'Data'
): asserts bounds is WGS84Bounds {
  if (!isValidWGS84Bounds(bounds)) {
    throw new Error(
      `[${context}] Invalid bounds format: ${JSON.stringify(bounds)}. ` +
      `Expected [west, south, east, north] in WGS84 degrees.`
    );
  }
}

/**
 * Log bounds validation result for debugging
 */
export function logBoundsValidation(
  bounds: WGS84Bounds,
  context: string,
  reference: WGS84Bounds = GERMANY_BBOX
): void {
  const isValid = isValidWGS84Bounds(bounds);
  const intersects = isValid && boundsIntersect(bounds, reference);
  const coverage = isValid ? calculateCoverageRatio(bounds, reference) : 0;
  
  console.log(`[${context}] Bounds validation:`, {
    bounds,
    valid: isValid,
    intersectsReference: intersects,
    coveragePercent: Math.round(coverage * 100),
  });
}

/**
 * Check if canvas/raster has non-transparent pixels
 */
export function hasVisiblePixels(
  imageData: ImageData | HTMLCanvasElement,
  minNonTransparentPercent: number = 1
): boolean {
  let data: Uint8ClampedArray;
  
  if (imageData instanceof ImageData) {
    data = imageData.data;
  } else {
    const ctx = imageData.getContext('2d');
    if (!ctx) return false;
    const imgData = ctx.getImageData(0, 0, imageData.width, imageData.height);
    data = imgData.data;
  }
  
  let nonTransparent = 0;
  const totalPixels = data.length / 4;
  
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) nonTransparent++;
  }
  
  const percent = (nonTransparent / totalPixels) * 100;
  return percent >= minNonTransparentPercent;
}

/**
 * Assert that raster has visible pixels (not fully transparent)
 */
export function assertVisiblePixels(
  imageData: ImageData | HTMLCanvasElement,
  context: string,
  minNonTransparentPercent: number = 1
): void {
  if (!hasVisiblePixels(imageData, minNonTransparentPercent)) {
    const size = imageData instanceof ImageData 
      ? `${imageData.width}×${imageData.height}`
      : `${(imageData as HTMLCanvasElement).width}×${(imageData as HTMLCanvasElement).height}`;
      
    throw new Error(
      `[${context}] Raster is fully transparent (${size}). ` +
      `This may indicate no valid data or a rendering issue.`
    );
  }
}
