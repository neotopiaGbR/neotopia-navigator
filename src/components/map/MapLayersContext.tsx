import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';

export type BasemapType = 'map' | 'satellite' | 'terrain';

export interface OverlayConfig {
  enabled: boolean;
  opacity: number;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  metadata: Record<string, unknown>;
}

export interface MapLayersState {
  basemap: BasemapType;
  overlays: {
    ecostress: OverlayConfig;
    floodRisk: OverlayConfig;
  };
}

interface MapLayersContextType extends MapLayersState {
  setBasemap: (basemap: BasemapType) => void;
  toggleOverlay: (overlay: 'ecostress' | 'floodRisk') => void;
  setOverlayOpacity: (overlay: 'ecostress' | 'floodRisk', opacity: number) => void;
  setOverlayLoading: (overlay: 'ecostress' | 'floodRisk', loading: boolean) => void;
  setOverlayError: (overlay: 'ecostress' | 'floodRisk', error: string | null) => void;
  setOverlayMetadata: (overlay: 'ecostress' | 'floodRisk', metadata: Record<string, unknown>) => void;
}

const defaultOverlay: OverlayConfig = {
  enabled: false,
  opacity: 70,
  loading: false,
  error: null,
  lastUpdated: null,
  metadata: {},
};

const MapLayersContext = createContext<MapLayersContextType | undefined>(undefined);

export const MapLayersProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [basemap, setBasemap] = useState<BasemapType>('map');
  const [overlays, setOverlays] = useState<MapLayersState['overlays']>({
    ecostress: { ...defaultOverlay },
    floodRisk: { ...defaultOverlay },
  });

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
    setOverlays((prev) => ({
      ...prev,
      [overlay]: {
        ...prev[overlay],
        opacity: Math.max(0, Math.min(100, opacity)),
      },
    }));
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
          lastUpdated: new Date().toISOString(),
        },
      }));
    },
    []
  );

  return (
    <MapLayersContext.Provider
      value={{
        basemap,
        overlays,
        setBasemap,
        toggleOverlay,
        setOverlayOpacity,
        setOverlayLoading,
        setOverlayError,
        setOverlayMetadata,
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
