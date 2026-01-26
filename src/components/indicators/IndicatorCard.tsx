import React from 'react';
import { RegionIndicatorData } from '@/hooks/useRegionIndicators';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface IndicatorCardProps {
  data: RegionIndicatorData;
  selectedYear: number | null;
  onClick?: () => void;
}

const IndicatorCard: React.FC<IndicatorCardProps> = ({ data, selectedYear, onClick }) => {
  const { 
    indicator, 
    values,
    latestYear,
    selectedYearValue,
    delta,
    deltaPercent,
    sparklineValues,
  } = data;

  // Determine effective year for display
  const displayYear = selectedYear ?? latestYear;
  const displayValue = selectedYearValue;

  // Determine trend based on delta
  const getTrend = (): 'up' | 'down' | 'neutral' => {
    if (delta === null || delta === 0) return 'neutral';
    return delta > 0 ? 'up' : 'down';
  };

  const trend = getTrend();
  const hasMultipleYears = values.length > 1;
  const hasDelta = delta !== null && hasMultipleYears;

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

  const formatDelta = (value: number): string => {
    const sign = value > 0 ? '+' : '';
    if (Math.abs(value) >= 1000000) {
      return `${sign}${(value / 1000000).toFixed(1)}M`;
    }
    if (Math.abs(value) >= 1000) {
      return `${sign}${(value / 1000).toFixed(1)}K`;
    }
    return `${sign}${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })}`;
  };

  const formatPercent = (value: number): string => {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full cursor-pointer rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent"
    >
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
        {hasDelta && trend !== 'neutral' && (
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
          {formatValue(displayValue)}
        </span>
        <span className="text-xs text-muted-foreground">{indicator.unit}</span>
      </div>

      {/* Delta since previous year */}
      {hasDelta && (
        <div className="mt-1 flex items-center gap-2">
          <span
            className={`text-xs font-medium tabular-nums ${
              trend === 'up'
                ? 'text-accent'
                : trend === 'down'
                ? 'text-destructive'
                : 'text-muted-foreground'
            }`}
          >
            {formatDelta(delta!)}
          </span>
          {deltaPercent !== null && Math.abs(deltaPercent) < 1000 && (
            <span
              className={`text-xs tabular-nums ${
                trend === 'up'
                  ? 'text-accent/70'
                  : trend === 'down'
                  ? 'text-destructive/70'
                  : 'text-muted-foreground'
              }`}
            >
              ({formatPercent(deltaPercent)})
            </span>
          )}
          <span className="text-xs text-muted-foreground">vs. Vorjahr</span>
        </div>
      )}

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {displayYear ? `Stand ${displayYear}` : 'Keine Daten'}
        </span>
        {hasMultipleYears && (
          <span className="text-xs text-muted-foreground">
            {values.length} Jahre
          </span>
        )}
      </div>

      {/* Mini sparkline (last 5 years) */}
      {sparklineValues.length > 1 && (
        <div className="mt-2 flex h-4 items-end gap-px">
          {sparklineValues.map((v, i) => {
            const max = Math.max(...sparklineValues.map((x) => x.value));
            const min = Math.min(...sparklineValues.map((x) => x.value));
            const range = max - min || 1;
            const height = ((v.value - min) / range) * 100;
            const isLatest = i === sparklineValues.length - 1;
            return (
              <div
                key={v.year}
                className={`flex-1 rounded-sm transition-colors ${
                  isLatest
                    ? 'bg-accent/60 group-hover:bg-accent/80'
                    : 'bg-accent/30 group-hover:bg-accent/50'
                }`}
                style={{ height: `${Math.max(height, 10)}%` }}
                title={`${v.year}: ${formatValue(v.value)}`}
              />
            );
          })}
        </div>
      )}
    </button>
  );
};

export default IndicatorCard;
