import { useMemo } from 'react';
import { Thermometer } from 'lucide-react';
import type { AirTempAggregation } from './MapLayersContext';

interface AirTemperatureLegendProps {
  visible: boolean;
  aggregation: AirTempAggregation;
  normalization?: { p5: number; p95: number; min: number; max: number };
  year?: number;
  /** Temperature value for the selected region (if available) */
  regionValue?: number | null;
  regionName?: string | null;
}

/**
 * DWD color ramp matching the overlay:
 * 14°C → blue, 18°C → green, 22°C → yellow, 26°C → orange, 30°C → red, 35°C → dark red
 */
const COLOR_STOPS = [
  { temp: 14, color: '#2563eb', label: '14' },
  { temp: 18, color: '#22c55e', label: '18' },
  { temp: 22, color: '#eab308', label: '22' },
  { temp: 26, color: '#f97316', label: '26' },
  { temp: 30, color: '#dc2626', label: '30' },
  { temp: 35, color: '#7f1d1d', label: '35+' },
];

export function AirTemperatureLegend({ 
  visible, 
  aggregation, 
  normalization,
  year,
  regionValue,
  regionName,
}: AirTemperatureLegendProps) {
  if (!visible) return null;

  const aggregationLabel = aggregation === 'daily_max' ? 'Tagesmaximum' : 'Tagesmittel';
  
  // Build gradient CSS from color stops
  const gradientCss = useMemo(() => {
    const stops = COLOR_STOPS.map((s, i) => {
      const percent = (i / (COLOR_STOPS.length - 1)) * 100;
      return `${s.color} ${percent}%`;
    });
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, []);

  return (
    <div className="bg-background/90 backdrop-blur p-3 rounded-lg border border-border/50 shadow-sm text-xs min-w-[220px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Thermometer className="h-4 w-4 text-orange-500" />
        <div className="flex-1">
          <div className="font-medium">Lufttemperatur (DWD)</div>
          <div className="text-[10px] text-muted-foreground">
            {aggregationLabel} · Sommer {year ?? '—'}
          </div>
        </div>
      </div>
      
      {/* Region Value Display */}
      {regionValue !== undefined && regionValue !== null && (
        <div className="mb-3 p-2 rounded bg-muted/50 border border-border/30">
          <div className="text-[10px] text-muted-foreground truncate" title={regionName ?? undefined}>
            {regionName ?? 'Ausgewählte Region'}
          </div>
          <div className="text-lg font-bold tabular-nums">
            {regionValue.toFixed(1)}°C
          </div>
        </div>
      )}
      
      {/* Color Gradient Bar */}
      <div 
        className="h-3 w-full rounded-full mb-1" 
        style={{ background: gradientCss }} 
      />
      
      {/* Temperature Labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground">
        {COLOR_STOPS.map((stop) => (
          <span key={stop.temp}>{stop.label}</span>
        ))}
      </div>
      
      {/* Stats */}
      {normalization && (
        <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-muted-foreground">
          <div className="flex justify-between">
            <span>P5–P95:</span>
            <span className="font-mono">{normalization.p5.toFixed(1)}–{normalization.p95.toFixed(1)}°C</span>
          </div>
        </div>
      )}
      
      {/* Attribution */}
      <div className="mt-2 text-[9px] text-muted-foreground/70">
        DWD HYRAS-DE · CC BY 4.0
      </div>
    </div>
  );
}

export default AirTemperatureLegend;
