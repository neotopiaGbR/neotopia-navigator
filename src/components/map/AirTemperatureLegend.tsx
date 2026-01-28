/**
 * Air Temperature Map Legend
 * 
 * Always-visible legend card when the Lufttemperatur layer is enabled.
 * Shows the perceptual color scale with temperature values based on P5-P95 normalization.
 */

import React from 'react';
import { Thermometer } from 'lucide-react';
import { getLegendEntries } from './airTemperature/gridToGeoJson';
import type { AirTempAggregation } from './MapLayersContext';

interface AirTemperatureLegendProps {
  visible: boolean;
  normalization: {
    p5: number;
    p95: number;
    min: number;
    max: number;
  } | null;
  aggregation: AirTempAggregation;
  year?: number;
  period?: string;
  pointCount?: number;
}

export const AirTemperatureLegend: React.FC<AirTemperatureLegendProps> = ({
  visible,
  normalization,
  aggregation,
  year,
  period,
  pointCount,
}) => {
  if (!visible || !normalization) return null;

  const legendEntries = getLegendEntries(normalization);
  const aggregationLabel = aggregation === 'daily_max' ? 'Tagesmax' : 'Tagesmittel';
  
  return (
    <div className="absolute bottom-24 left-3 z-10 bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-lg p-3 min-w-[200px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Thermometer className="h-4 w-4 text-teal-500" />
        <span className="text-xs font-semibold text-foreground">Lufttemperatur (2m)</span>
      </div>
      
      {/* Metadata */}
      <div className="text-[10px] text-muted-foreground mb-2 space-y-0.5">
        {year && <p>Sommer {year} (Jun–Aug)</p>}
        <p>{aggregationLabel} · ERA5-Land ~9km</p>
        {pointCount && <p>{pointCount} Datenpunkte</p>}
      </div>
      
      {/* Color gradient bar */}
      <div 
        className="h-3 w-full rounded-sm mb-1"
        style={{
          background: `linear-gradient(to right, ${legendEntries.map(e => e.color).join(', ')})`,
        }}
      />
      
      {/* Temperature labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{legendEntries[0].label}</span>
        <span>{legendEntries[Math.floor(legendEntries.length / 2)].label}</span>
        <span>{legendEntries[legendEntries.length - 1].label}</span>
      </div>
      
      {/* Normalization note */}
      <p className="text-[9px] text-muted-foreground/70 mt-2 pt-1 border-t border-border/50">
        Normalisierung: P5–P95 ({normalization.p5.toFixed(1)}°C – {normalization.p95.toFixed(1)}°C)
      </p>
    </div>
  );
};

export default AirTemperatureLegend;
