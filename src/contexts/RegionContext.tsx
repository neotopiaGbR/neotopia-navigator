import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface Region {
  id: string;
  name: string;
  geom: GeoJSON.Geometry;
}

interface RegionContextType {
  regions: Region[];
  setRegions: (regions: Region[]) => void;
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

  const selectedRegion = regions.find((r) => r.id === selectedRegionId) || null;
  const comparisonRegion = regions.find((r) => r.id === comparisonRegionId) || null;

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
