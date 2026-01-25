import React from 'react';
import { RegionIndicatorData } from '@/hooks/useRegionIndicators';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface IndicatorCardProps {
  data: RegionIndicatorData;
}

const IndicatorCard: React.FC<IndicatorCardProps> = ({ data }) => {
  const { indicator, values, latestValue, latestYear } = data;

  // Calculate trend (compare last two values if available)
  const getTrend = (): 'up' | 'down' | 'neutral' => {
    if (values.length < 2) return 'neutral';
    const prev = values[values.length - 2].value;
    const curr = values[values.length - 1].value;
    if (curr > prev) return 'up';
    if (curr < prev) return 'down';
    return 'neutral';
  };

  const trend = getTrend();

  const formatValue = (value: number | null): string => {
    if (value === null) return '—';
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  };

  return (
    <div className="group rounded-md border border-border bg-card p-3 transition-colors hover:border-accent/50">
      {/* Header */}
      <div className="mb-2 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {indicator.code}
          </p>
          <p className="mt-0.5 truncate text-sm text-foreground" title={indicator.name}>
            {indicator.name}
          </p>
        </div>
        {trend !== 'neutral' && (
          <div
            className={`ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded ${
              trend === 'up' ? 'text-accent' : 'text-destructive'
            }`}
          >
            {trend === 'up' ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
          </div>
        )}
      </div>

      {/* Value */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums text-foreground">
          {formatValue(latestValue)}
        </span>
        <span className="text-xs text-muted-foreground">{indicator.unit}</span>
      </div>

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {latestYear ? `Stand ${latestYear}` : 'Keine Daten'}
        </span>
        {values.length > 1 && (
          <span className="text-xs text-muted-foreground">
            {values.length} Jahre
          </span>
        )}
      </div>

      {/* Mini sparkline indicator (visual only) */}
      {values.length > 1 && (
        <div className="mt-2 flex h-4 items-end gap-px">
          {values.slice(-8).map((v, i) => {
            const max = Math.max(...values.slice(-8).map((x) => x.value));
            const min = Math.min(...values.slice(-8).map((x) => x.value));
            const range = max - min || 1;
            const height = ((v.value - min) / range) * 100;
            return (
              <div
                key={i}
                className="flex-1 rounded-sm bg-accent/30 transition-colors group-hover:bg-accent/50"
                style={{ height: `${Math.max(height, 10)}%` }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default IndicatorCard;
