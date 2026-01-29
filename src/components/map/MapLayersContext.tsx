import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';

export type BasemapType = 'map' | 'satellite' | 'terrain';
export type AggregationMethod = 'median' | 'p90' | 'max';
export type AirTempAggregation = 'daily_max' | 'daily_mean';

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

export interface AirTemperatureConfig {
  enabled: boolean;
  opacity: number;
  loading: boolean;
  error: string | null;
  aggregation: AirTempAggregation;
  data: AirTemperatureData | null;
  metadata: AirTemperatureMetadata | null;
}

export interface MonthlyTemperatureValue {
  month: number;
  monthName: string;
  value: number;
}

export interface AirTemperatureData {
  grid: Array<{ lat: number; lon: number; value: number }>;
  bounds: [number, number, number, number];
  year: number;
  aggregation: AirTempAggregation;
  period: string;
  resolution_km: number;
  /** Effective cell size in meters (includes sample step) */
  cellsize_m: number;
  normalization: {
    p5: number;
    p95: number;
    min: number;
    max: number;
  };
  /** Monthly values for selected region (June, July, August) */
  monthlyValues?: MonthlyTemperatureValue[];
}

export interface AirTemperatureMetadata {
  year: number;
  aggregation: AirTempAggregation;
  period: string;
  resolution_km: number;
  normalization: {
    p5: number;
    p95: number;
    min: number;
    max: number;
  };
  pointCount: number;
}

export interface MapLayersState {
  basemap: BasemapType;
  overlays: {
    ecostress: OverlayConfig;
    floodRisk: OverlayConfig;
  };
  heatLayers: HeatLayerTierConfig;
  airTemperature: AirTemperatureConfig;
}

type OverlayType = 'ecostress' | 'floodRisk';

interface MapLayersContextType extends MapLayersState {
  setBasemap: (basemap: BasemapType) => void;
  toggleOverlay: (overlay: OverlayType) => void;
  setOverlayOpacity: (overlay: OverlayType, opacity: number) => void;
  setOverlayLoading: (overlay: OverlayType, loading: boolean) => void;
  setOverlayError: (overlay: OverlayType, error: string | null) => void;
  setOverlayMetadata: (overlay: OverlayType, metadata: Record<string, unknown>) => void;
  // Heat layer tier controls
  setHeatLayerOpacity: (tier: 'globalLST' | 'ecostress', opacity: number) => void;
  setEcostressMinCoverage: (coverage: number) => void;
  setAggregationMethod: (method: AggregationMethod) => void;
  // Air temperature layer controls
  toggleAirTemperature: () => void;
  setAirTemperatureOpacity: (opacity: number) => void;
  setAirTemperatureAggregation: (aggregation: AirTempAggregation) => void;
  setAirTemperatureLoading: (loading: boolean) => void;
  setAirTemperatureError: (error: string | null) => void;
  setAirTemperatureData: (data: AirTemperatureData | null) => void;
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
  aggregationMethod: 'p90', // Default to P90 for urban heat island analysis
};

const defaultAirTemperature: AirTemperatureConfig = {
  enabled: false,
  opacity: 60,
  loading: false,
  error: null,
  aggregation: 'daily_max',
  data: null,
  metadata: null,
};

const MapLayersContext = createContext<MapLayersContextType | undefined>(undefined);

export const MapLayersProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [basemap, setBasemap] = useState<BasemapType>('map');
  const [overlays, setOverlays] = useState<MapLayersState['overlays']>({
    ecostress: { ...defaultOverlay },
    floodRisk: { ...defaultOverlay },
  });
  const [heatLayers, setHeatLayers] = useState<HeatLayerTierConfig>(defaultHeatLayers);
  const [airTemperature, setAirTemperature] = useState<AirTemperatureConfig>(defaultAirTemperature);

  const toggleOverlay = useCallback((overlay: OverlayType) => {
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
    (overlay: OverlayType, metadata: Record<string, unknown>) => {
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

  // Air Temperature layer controls
  const toggleAirTemperature = useCallback(() => {
    setAirTemperature((prev) => ({
      ...prev,
      enabled: !prev.enabled,
      error: null,
    }));
  }, []);

  const setAirTemperatureOpacity = useCallback((opacity: number) => {
    setAirTemperature((prev) => ({
      ...prev,
      opacity: Math.max(0, Math.min(100, opacity)),
    }));
  }, []);

  const setAirTemperatureAggregation = useCallback((aggregation: AirTempAggregation) => {
    setAirTemperature((prev) => ({
      ...prev,
      aggregation,
      data: null, // Reset data to trigger refetch
    }));
  }, []);

  const setAirTemperatureLoading = useCallback((loading: boolean) => {
    setAirTemperature((prev) => ({ ...prev, loading }));
  }, []);

  const setAirTemperatureError = useCallback((error: string | null) => {
    setAirTemperature((prev) => ({ ...prev, error, loading: false }));
  }, []);

  const setAirTemperatureData = useCallback((data: AirTemperatureData | null) => {
    setAirTemperature((prev) => ({
      ...prev,
      data,
      loading: false,
      error: null,
      metadata: data ? {
        year: data.year,
        aggregation: data.aggregation,
        period: data.period,
        resolution_km: data.resolution_km,
        normalization: data.normalization,
        pointCount: data.grid.length,
      } : null,
    }));
  }, []);

  return (
    <MapLayersContext.Provider
      value={{
        basemap,
        overlays,
        heatLayers,
        airTemperature,
        setBasemap,
        toggleOverlay,
        setOverlayOpacity,
        setOverlayLoading,
        setOverlayError,
        setOverlayMetadata,
        setHeatLayerOpacity,
        setEcostressMinCoverage,
        setAggregationMethod,
        toggleAirTemperature,
        setAirTemperatureOpacity,
        setAirTemperatureAggregation,
        setAirTemperatureLoading,
        setAirTemperatureError,
        setAirTemperatureData,
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
