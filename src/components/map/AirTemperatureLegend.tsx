import { useMemo } from 'react';
import { Thermometer, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AirTempAggregation } from './MapLayersContext';

interface AirTemperatureLegendProps {
  visible: boolean;
  aggregation: AirTempAggregation;
  normalization?: { p5: number; p95: number; min: number; max: number };
  year?: number;
  /** Temperature value for the selected region (if available) */
  regionValue?: number | null;
  regionName?: string | null;
  /** Full grid data to compute top 3 hottest cells */
  gridData?: Array<{ lat: number; lon: number; value: number }>;
  /** Region bounding box [minLon, minLat, maxLon, maxLat] to filter grid cells */
  regionBbox?: [number, number, number, number] | null;
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

/**
 * Expand bbox by a buffer (in degrees) to capture nearby cells
 */
function expandBbox(
  bbox: [number, number, number, number], 
  bufferDeg: number = 0.05
): [number, number, number, number] {
  return [
    bbox[0] - bufferDeg,
    bbox[1] - bufferDeg,
    bbox[2] + bufferDeg,
    bbox[3] + bufferDeg,
  ];
}

/**
 * Check if a point is within a bounding box
 */
function isInBbox(
  lon: number, 
  lat: number, 
  bbox: [number, number, number, number]
): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

export function AirTemperatureLegend({ 
  visible, 
  aggregation, 
  normalization,
  year,
  regionValue,
  regionName,
  gridData,
  regionBbox,
}: AirTemperatureLegendProps) {
  if (!visible) return null;

  // Precise labels with Ø prefix
  const aggregationLabel = aggregation === 'daily_max' ? 'Ø Tagesmaximum' : 'Ø Tagesmittel';
  const aggregationTooltip = aggregation === 'daily_max' 
    ? 'Durchschnitt der täglichen Höchsttemperaturen über den gesamten Sommer (Juni–August)'
    : 'Durchschnitt der 24h-Mittelwerte über den gesamten Sommer (Juni–August)';
  
  // Build gradient CSS from color stops
  const gradientCss = useMemo(() => {
    const stops = COLOR_STOPS.map((s, i) => {
      const percent = (i / (COLOR_STOPS.length - 1)) * 100;
      return `${s.color} ${percent}%`;
    });
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, []);

  // Compute top 3 hottest cells from grid data within the region bbox
  const top3Hottest = useMemo(() => {
    if (!gridData || gridData.length === 0 || !regionBbox) return null;
    
    // Expand bbox slightly to capture nearby cells
    const searchBbox = expandBbox(regionBbox, 0.02);
    
    // Filter cells within/near the region
    const regionCells = gridData.filter(cell => 
      isInBbox(cell.lon, cell.lat, searchBbox)
    );
    
    if (regionCells.length === 0) return null;
    
    // Sort by value descending and take top 3
    const sorted = [...regionCells].sort((a, b) => b.value - a.value);
    return sorted.slice(0, 3);
  }, [gridData, regionBbox]);

  return (
    <div className="bg-background/90 backdrop-blur p-3 rounded-lg border border-border/50 shadow-sm text-xs min-w-[220px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Thermometer className="h-4 w-4 text-orange-500" />
        <div className="flex-1">
          <div className="font-medium flex items-center gap-1">
            Lufttemperatur (DWD)
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[250px] text-xs">
                <p className="font-medium mb-1">{aggregationLabel}</p>
                <p>{aggregationTooltip}</p>
              </TooltipContent>
            </Tooltip>
          </div>
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
      
      {/* Top 3 Hottest Cells in Region */}
      {top3Hottest && top3Hottest.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border/30">
          <div className="text-[10px] text-muted-foreground mb-1 font-medium">
            🔥 Top 3 in Region (JJA)
          </div>
          <div className="space-y-0.5">
            {top3Hottest.map((cell, idx) => (
              <div key={idx} className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">#{idx + 1}</span>
                <span className="font-mono font-medium">{cell.value.toFixed(1)}°C</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
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
