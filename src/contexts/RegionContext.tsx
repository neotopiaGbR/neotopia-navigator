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
}

const RegionContext = createContext<RegionContextType | undefined>(undefined);

export const RegionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  const selectedRegion = regions.find((r) => r.id === selectedRegionId) || null;

  // Reset year when region changes
  const handleSetSelectedRegionId = (id: string | null) => {
    if (id !== selectedRegionId) {
      setSelectedYear(null);
      setAvailableYears([]);
    }
    setSelectedRegionId(id);
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
