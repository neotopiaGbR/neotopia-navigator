import { getTemperatureColor } from './basemapStyles';

interface AirTemperatureLegendProps {
  min: number;
  max: number;
  unit?: string;
}

export function AirTemperatureLegend({ min, max, unit = '°C' }: AirTemperatureLegendProps) {
  // Erzeuge 5 Stützstellen für den Gradienten
  const steps = 5;
  const gradientStops = Array.from({ length: steps }).map((_, i) => {
    const t = i / (steps - 1);
    const val = min + t * (max - min);
    const color = getTemperatureColor(val, min, max);
    return { val, color, percent: t * 100 };
  });

  const gradientCss = `linear-gradient(to right, ${gradientStops.map(s => `${s.color} ${s.percent}%`).join(', ')})`;

  return (
    <div className="bg-background/90 backdrop-blur p-3 rounded-lg border border-border/50 shadow-sm text-xs min-w-[200px]">
      <div className="font-medium mb-2 flex justify-between">
        <span>Lufttemperatur</span>
        <span className="text-muted-foreground">({unit})</span>
      </div>
      
      {/* Gradient Bar */}
      <div 
        className="h-3 w-full rounded-full mb-1" 
        style={{ background: gradientCss }} 
      />
      
      {/* Labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{Math.round(min)}</span>
        <span>{Math.round(min + (max - min) * 0.25)}</span>
        <span>{Math.round(min + (max - min) * 0.5)}</span>
        <span>{Math.round(min + (max - min) * 0.75)}</span>
        <span>{Math.round(max)}</span>
      </div>
    </div>
  );
}

export default AirTemperatureLegend;
