import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';

export type BasemapType = 'map' | 'satellite' | 'terrain';
export type AggregationMethod = 'median' | 'p90' | 'max';

export interface OverlayConfig {
  enabled: boolean;
  opacity: number;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  metadata: Record<string, unknown>;
}

export interface HeatLayerTierConfig {
  globalLSTEnabled: boolean; // TIER 1: MODIS/VIIRS (always on when heat enabled)
  globalLSTOpacity: number;
  ecostressEnabled: boolean; // TIER 2: High-res overlay
  ecostressOpacity: number;
  ecostressMinCoverage: number; // Minimum coverage threshold (default 0.8 = 80%)
  aggregationMethod: AggregationMethod; // Median or P90 for extreme heat
}

export interface MapLayersState {
  basemap: BasemapType;
  overlays: {
    ecostress: OverlayConfig;
    floodRisk: OverlayConfig;
  };
  heatLayers: HeatLayerTierConfig;
}

interface MapLayersContextType extends MapLayersState {
  setBasemap: (basemap: BasemapType) => void;
  toggleOverlay: (overlay: 'ecostress' | 'floodRisk') => void;
  setOverlayOpacity: (overlay: 'ecostress' | 'floodRisk', opacity: number) => void;
  setOverlayLoading: (overlay: 'ecostress' | 'floodRisk', loading: boolean) => void;
  setOverlayError: (overlay: 'ecostress' | 'floodRisk', error: string | null) => void;
  setOverlayMetadata: (overlay: 'ecostress' | 'floodRisk', metadata: Record<string, unknown>) => void;
  // Heat layer tier controls
  setHeatLayerOpacity: (tier: 'globalLST' | 'ecostress', opacity: number) => void;
  setEcostressMinCoverage: (coverage: number) => void;
  setAggregationMethod: (method: AggregationMethod) => void;
}

const defaultOverlay: OverlayConfig = {
  enabled: false,
  opacity: 70,
  loading: false,
  error: null,
  lastUpdated: null,
  metadata: {},
};

const defaultHeatLayers: HeatLayerTierConfig = {
  globalLSTEnabled: true, // Always on when heat overlay enabled
  globalLSTOpacity: 60,
  ecostressEnabled: true, // Try to enhance with ECOSTRESS
  ecostressOpacity: 80,
  ecostressMinCoverage: 0.8, // 80% coverage threshold
  aggregationMethod: 'median', // Default to median aggregation
};

const MapLayersContext = createContext<MapLayersContextType | undefined>(undefined);

export const MapLayersProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [basemap, setBasemap] = useState<BasemapType>('map');
  const [overlays, setOverlays] = useState<MapLayersState['overlays']>({
    ecostress: { ...defaultOverlay },
    floodRisk: { ...defaultOverlay },
  });
  const [heatLayers, setHeatLayers] = useState<HeatLayerTierConfig>(defaultHeatLayers);

  const toggleOverlay = useCallback((overlay: 'ecostress' | 'floodRisk') => {
    setOverlays((prev) => ({
      ...prev,
      [overlay]: {
        ...prev[overlay],
        enabled: !prev[overlay].enabled,
        error: null,
      },
    }));
  }, []);

  const setOverlayOpacity = useCallback((overlay: 'ecostress' | 'floodRisk', opacity: number) => {
    const clampedOpacity = Math.max(0, Math.min(100, opacity));
    setOverlays((prev) => ({
      ...prev,
      [overlay]: {
        ...prev[overlay],
        opacity: clampedOpacity,
      },
    }));
    // Sync with heat layer tiers for ecostress
    if (overlay === 'ecostress') {
      setHeatLayers((prev) => ({ ...prev, ecostressOpacity: clampedOpacity }));
    }
  }, []);

  const setOverlayLoading = useCallback((overlay: 'ecostress' | 'floodRisk', loading: boolean) => {
    setOverlays((prev) => ({
      ...prev,
      [overlay]: {
        ...prev[overlay],
        loading,
      },
    }));
  }, []);

  const setOverlayError = useCallback((overlay: 'ecostress' | 'floodRisk', error: string | null) => {
    setOverlays((prev) => ({
      ...prev,
      [overlay]: {
        ...prev[overlay],
        error,
        loading: false,
      },
    }));
  }, []);

  const setOverlayMetadata = useCallback(
    (overlay: 'ecostress' | 'floodRisk', metadata: Record<string, unknown>) => {
      setOverlays((prev) => ({
        ...prev,
        [overlay]: {
          ...prev[overlay],
          metadata,
          error: null,
          loading: false,
          lastUpdated: new Date().toISOString(),
        },
      }));
    },
    []
  );

  const setHeatLayerOpacity = useCallback((tier: 'globalLST' | 'ecostress', opacity: number) => {
    const clampedOpacity = Math.max(0, Math.min(100, opacity));
    setHeatLayers((prev) => ({
      ...prev,
      [`${tier}Opacity`]: clampedOpacity,
    }));
    // Sync ecostress opacity with overlay config
    if (tier === 'ecostress') {
      setOverlays((prev) => ({
        ...prev,
        ecostress: { ...prev.ecostress, opacity: clampedOpacity },
      }));
    }
  }, []);

  const setEcostressMinCoverage = useCallback((coverage: number) => {
    setHeatLayers((prev) => ({
      ...prev,
      ecostressMinCoverage: Math.max(0, Math.min(1, coverage)),
    }));
  }, []);

  const setAggregationMethod = useCallback((method: AggregationMethod) => {
    setHeatLayers((prev) => ({
      ...prev,
      aggregationMethod: method,
    }));
  }, []);

  return (
    <MapLayersContext.Provider
      value={{
        basemap,
        overlays,
        heatLayers,
        setBasemap,
        toggleOverlay,
        setOverlayOpacity,
        setOverlayLoading,
        setOverlayError,
        setOverlayMetadata,
        setHeatLayerOpacity,
        setEcostressMinCoverage,
        setAggregationMethod,
      }}
    >
      {children}
    </MapLayersContext.Provider>
  );
};

export const useMapLayers = () => {
  const context = useContext(MapLayersContext);
  if (context === undefined) {
    throw new Error('useMapLayers must be used within a MapLayersProvider');
  }
  return context;
};
