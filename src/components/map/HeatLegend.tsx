/**
 * Heat Layer Legend - Always visible on map when heat overlay is active
 */

import React from 'react';
import { Flame } from 'lucide-react';

const HEAT_LEGEND_COLORS = [
  { color: '#313695', label: '< 20°C' },
  { color: '#4575b4', label: '25°C' },
  { color: '#74add1', label: '30°C' },
  { color: '#abd9e9', label: '35°C' },
  { color: '#fee090', label: '40°C' },
  { color: '#fdae61', label: '45°C' },
  { color: '#f46d43', label: '50°C' },
  { color: '#d73027', label: '> 55°C' },
];

interface HeatLegendProps {
  visible: boolean;
  aggregationMethod?: 'median' | 'p90' | 'max';
  granuleCount?: number;
}

const HeatLegend: React.FC<HeatLegendProps> = ({ 
  visible, 
  aggregationMethod = 'median',
  granuleCount,
}) => {
  if (!visible) return null;

  const aggregationLabel = 
    aggregationMethod === 'max' ? 'Maximum' :
    aggregationMethod === 'p90' ? '90. Perzentil' : 'Median';

  return (
    <div className="bg-background/90 backdrop-blur p-3 rounded-lg border border-border/50 shadow-sm text-xs min-w-[200px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Flame className="h-4 w-4 text-orange-500" />
        <span className="font-medium">Hitze-Hotspots</span>
      </div>

      {/* Gradient bar */}
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
        NASA GIBS / ECOSTRESS
      </p>
    </div>
  );
};

export default HeatLegend;
