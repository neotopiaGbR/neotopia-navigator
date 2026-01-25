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
}

const RegionContext = createContext<RegionContextType | undefined>(undefined);

export const RegionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);

  const selectedRegion = regions.find((r) => r.id === selectedRegionId) || null;

  return (
    <RegionContext.Provider
      value={{
        regions,
        setRegions,
        selectedRegionId,
        setSelectedRegionId,
        selectedRegion,
        hoveredRegionId,
        setHoveredRegionId,
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
