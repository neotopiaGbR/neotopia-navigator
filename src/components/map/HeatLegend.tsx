/**
 * Heat Layer Legend - Always visible on map when heat overlay is active
 * Shows aggregation method, granule count, and mean temperature
 */

import React from 'react';
import { Flame, Thermometer } from 'lucide-react';

// NASA LST color palette matching compositeUtils.ts kelvinToRGBA
const HEAT_LEGEND_COLORS = [
  { color: '#00B4FF', label: '20°C' },  // Blue
  { color: '#00FFAA', label: '30°C' },  // Cyan/Green
  { color: '#FFFF00', label: '37°C' },  // Yellow
  { color: '#FF8800', label: '45°C' },  // Orange
  { color: '#FF0000', label: '55°C+' }, // Red
];

interface HeatLegendProps {
  visible: boolean;
  aggregationMethod?: 'median' | 'p90' | 'max';
  granuleCount?: number;
  meanTemperature?: number; // Mean temperature in Kelvin
}

const HeatLegend: React.FC<HeatLegendProps> = ({ 
  visible, 
  aggregationMethod = 'p90',
  granuleCount,
  meanTemperature,
}) => {
  if (!visible) return null;

  const aggregationLabel = 
    aggregationMethod === 'max' ? 'Maximum' : '90. Perzentil';

  // Convert Kelvin to Celsius for display
  const meanCelsius = meanTemperature ? (meanTemperature - 273.15).toFixed(1) : null;

  return (
    <div className="bg-background/90 backdrop-blur p-3 rounded-lg border border-border/50 shadow-sm text-xs min-w-[200px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Flame className="h-4 w-4 text-orange-500" />
        <span className="font-medium">Hitze-Hotspots</span>
      </div>

      {/* Gradient bar - NASA LST palette */}
      <div 
        className="h-3 w-full rounded-full mb-1"
        style={{
          background: `linear-gradient(to right, ${HEAT_LEGEND_COLORS.map(c => c.color).join(', ')})`
        }}
      />

      {/* Labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground mb-2">
        <span>20°C</span>
        <span>35°C</span>
        <span>55°C+</span>
      </div>

      {/* Mean Temperature - Highlight */}
      {meanCelsius && (
        <div className="bg-primary/10 rounded-md p-2 mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Thermometer className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] text-muted-foreground">Ø Temperatur:</span>
          </div>
          <span className="font-semibold text-primary">{meanCelsius}°C</span>
        </div>
      )}

      {/* Metadata */}
      <div className="text-[10px] text-muted-foreground border-t border-border/50 pt-2 space-y-0.5">
        <div className="flex justify-between">
          <span>Aggregation:</span>
          <span className="font-medium text-foreground">{aggregationLabel}</span>
        </div>
        {granuleCount && granuleCount > 0 && (
          <div className="flex justify-between">
            <span>Aufnahmen:</span>
            <span className="font-medium text-foreground">{granuleCount}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Zeitraum:</span>
          <span className="font-medium text-foreground">Jun–Aug</span>
        </div>
      </div>

      {/* Attribution */}
      <p className="text-[9px] text-muted-foreground/60 mt-1.5">
        NASA ECOSTRESS LST
      </p>
    </div>
  );
};

export default HeatLegend;