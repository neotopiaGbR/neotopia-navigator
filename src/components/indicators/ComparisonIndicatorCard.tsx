import React from 'react';
import { RegionIndicatorData } from '@/hooks/useRegionIndicators';
import { TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react';

interface ComparisonIndicatorCardProps {
  primaryData: RegionIndicatorData;
  comparisonData: RegionIndicatorData | null;
  primaryRegionName: string;
  comparisonRegionName: string | null;
  selectedYear: number | null;
  onClick?: () => void;
}

const ComparisonIndicatorCard: React.FC<ComparisonIndicatorCardProps> = ({
  primaryData,
  comparisonData,
  primaryRegionName,
  comparisonRegionName,
  selectedYear,
  onClick,
}) => {
  const { indicator } = primaryData;

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

  const primaryValue = primaryData.selectedYearValue;
  const comparisonValue = comparisonData?.selectedYearValue ?? null;

  // Calculate delta between regions
  let regionDelta: number | null = null;
  let regionDeltaPercent: number | null = null;

  if (primaryValue !== null && comparisonValue !== null) {
    regionDelta = primaryValue - comparisonValue;
    if (comparisonValue !== 0) {
      regionDeltaPercent = (regionDelta / Math.abs(comparisonValue)) * 100;
    }
  }

  const getDeltaTrend = (): 'higher' | 'lower' | 'equal' => {
    if (regionDelta === null || regionDelta === 0) return 'equal';
    return regionDelta > 0 ? 'higher' : 'lower';
  };

  const deltaTrend = getDeltaTrend();

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full cursor-pointer rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {/* Header */}
      <div className="mb-3">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {indicator.code}
        </p>
        <p className="mt-0.5 truncate text-sm text-foreground" title={indicator.name}>
          {indicator.name}
        </p>
      </div>

      {/* Side by Side Values */}
      <div className="grid grid-cols-2 gap-3">
        {/* Primary Region */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground truncate" title={primaryRegionName}>
            {primaryRegionName}
          </p>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums text-accent">
              {formatValue(primaryValue)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{indicator.unit}</p>
        </div>

        {/* Comparison Region */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground truncate" title={comparisonRegionName ?? ''}>
            {comparisonRegionName ?? '—'}
          </p>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums text-foreground">
              {formatValue(comparisonValue)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{indicator.unit}</p>
        </div>
      </div>

      {/* Delta Row */}
      {regionDelta !== null && (
        <div className="mt-3 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {deltaTrend === 'higher' ? (
                <TrendingUp className="h-3.5 w-3.5 text-accent" />
              ) : deltaTrend === 'lower' ? (
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <Minus className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span
                className={`text-xs font-medium tabular-nums ${
                  deltaTrend === 'higher'
                    ? 'text-accent'
                    : deltaTrend === 'lower'
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }`}
              >
                {formatDelta(regionDelta)}
              </span>
              {regionDeltaPercent !== null && Math.abs(regionDeltaPercent) < 1000 && (
                <span
                  className={`text-xs tabular-nums ${
                    deltaTrend === 'higher'
                      ? 'text-accent/70'
                      : deltaTrend === 'lower'
                      ? 'text-destructive/70'
                      : 'text-muted-foreground'
                  }`}
                >
                  ({formatPercent(regionDeltaPercent)})
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">Differenz</span>
          </div>
        </div>
      )}

      {/* Year Footer */}
      <div className="mt-2 text-right">
        <span className="text-xs text-muted-foreground">
          {selectedYear ? `Jahr ${selectedYear}` : ''}
        </span>
      </div>
    </button>
  );
};

export default ComparisonIndicatorCard;
