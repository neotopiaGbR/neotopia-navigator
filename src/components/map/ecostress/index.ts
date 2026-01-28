// ECOSTRESS module exports
// Note: EcostressCompositeOverlay is deprecated - use EcostressLayer with DeckOverlayManager instead

export { 
  createComposite, 
  kelvinToRGBA, 
  type AggregationMethod, 
  type CompositeResult,
  type CoverageConfidence,
  MAX_CLOUD_PERCENT,
  MIN_COVERAGE_PERCENT,
} from './compositeUtils';

// Re-export for backwards compatibility (will be removed)
export { EcostressCompositeOverlay, type CompositeMetadata, type GranuleData } from './EcostressCompositeOverlay';
