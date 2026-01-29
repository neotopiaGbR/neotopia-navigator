import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface Region {
  id: string;
  name: string;
  geom: GeoJSON.Geometry;
  // Optional precomputed bbox (W, S, E, N) when available
  bbox?: [number, number, number, number];
}

interface RegionContextType {
  regions: Region[];
  setRegions: (regions: Region[]) => void;
  removeRegion: (id: string) => void;
  clearAllRegions: () => void;
  selectedRegionId: string | null;
  setSelectedRegionId: (id: string | null) => void;
  selectedRegion: Region | null;
  hoveredRegionId: string | null;
  setHoveredRegionId: (id: string | null) => void;
  selectedYear: number | null;
  setSelectedYear: (year: number | null) => void;
  availableYears: number[];
  setAvailableYears: (years: number[]) => void;
  // Comparison mode
  comparisonMode: boolean;
  setComparisonMode: (enabled: boolean) => void;
  comparisonRegionId: string | null;
  setComparisonRegionId: (id: string | null) => void;
  comparisonRegion: Region | null;
  // Datasets used tracking
  datasetsUsed: string[];
  setDatasetsUsed: (datasets: string[]) => void;
}

const RegionContext = createContext<RegionContextType | undefined>(undefined);

export const RegionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonRegionId, setComparisonRegionId] = useState<string | null>(null);
  const [datasetsUsed, setDatasetsUsed] = useState<string[]>([]);

  const selectedRegion = regions.find((r) => r.id === selectedRegionId) || null;
  const comparisonRegion = regions.find((r) => r.id === comparisonRegionId) || null;

  // Remove a single region
  const removeRegion = (id: string) => {
    // Clear selection if removing selected region
    if (id === selectedRegionId) {
      setSelectedRegionId(null);
      setSelectedYear(null);
      setAvailableYears([]);
    }
    // Clear comparison if removing comparison region
    if (id === comparisonRegionId) {
      setComparisonRegionId(null);
    }
    setRegions(regions.filter((r) => r.id !== id));
  };

  // Clear all regions
  const clearAllRegions = () => {
    setSelectedRegionId(null);
    setComparisonRegionId(null);
    setSelectedYear(null);
    setAvailableYears([]);
    setRegions([]);
  };

  // Reset year when region changes
  const handleSetSelectedRegionId = (id: string | null) => {
    if (id !== selectedRegionId) {
      setSelectedYear(null);
      setAvailableYears([]);
    }
    setSelectedRegionId(id);
  };

  // Clear comparison when disabling
  const handleSetComparisonMode = (enabled: boolean) => {
    setComparisonMode(enabled);
    if (!enabled) {
      setComparisonRegionId(null);
    }
  };

  return (
    <RegionContext.Provider
      value={{
        regions,
        setRegions,
        removeRegion,
        clearAllRegions,
        selectedRegionId,
        setSelectedRegionId: handleSetSelectedRegionId,
        selectedRegion,
        hoveredRegionId,
        setHoveredRegionId,
        selectedYear,
        setSelectedYear,
        availableYears,
        setAvailableYears,
        comparisonMode,
        setComparisonMode: handleSetComparisonMode,
        comparisonRegionId,
        setComparisonRegionId,
        comparisonRegion,
        datasetsUsed,
        setDatasetsUsed,
      }}
    >
      {children}
    </RegionContext.Provider>
  );
};

export const useRegion = () => {
  const context = useContext(RegionContext);
  if (context === undefined) {
    throw new Error('useRegion must be used within a RegionProvider');
  }
  return context;
};
