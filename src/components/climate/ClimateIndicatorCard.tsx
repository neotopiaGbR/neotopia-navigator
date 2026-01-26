import React from 'react';
import { ClimateIndicatorData } from './types';
import { TrendingUp, TrendingDown, Minus, ThermometerSun, Droplets, AlertTriangle } from 'lucide-react';

interface ClimateIndicatorCardProps {
  data: ClimateIndicatorData;
  onClick?: () => void;
}

const ClimateIndicatorCard: React.FC<ClimateIndicatorCardProps> = ({ data, onClick }) => {
  const { indicator, baselineValue, projectedValue, absoluteChange, relativeChange, scenario, timeHorizon } = data;

  const isProjection = scenario !== 'historical' && timeHorizon !== 'baseline';
  const hasChange = absoluteChange !== null && isProjection;

  // Determine if change is problematic (for climate, increases are usually bad)
  const isProblematic = hasChange && !indicator.higherIsBetter && absoluteChange > 0;
  const isPositive = hasChange && indicator.higherIsBetter && absoluteChange > 0;

  const formatValue = (value: number | null): string => {
    if (value === null) return '—';
    if (indicator.unit === '%') {
      return value.toFixed(1);
    }
    return value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  };

  const formatChange = (value: number): string => {
    const sign = value > 0 ? '+' : '';
    if (indicator.unit === '%') {
      return `${sign}${value.toFixed(1)} Pp.`;
    }
    return `${sign}${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })}`;
  };

  const getCategoryIcon = () => {
    switch (indicator.category) {
      case 'temperature':
        return <ThermometerSun className="h-4 w-4" />;
      case 'extremes':
        return <AlertTriangle className="h-4 w-4" />;
      case 'precipitation':
        return <Droplets className="h-4 w-4" />;
      default:
        return <ThermometerSun className="h-4 w-4" />;
    }
  };

  const getTrendIcon = () => {
    if (!hasChange || absoluteChange === 0) {
      return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
    }
    if (isProblematic) {
      return <TrendingUp className="h-3.5 w-3.5 text-destructive" />;
    }
    if (isPositive) {
      return <TrendingUp className="h-3.5 w-3.5 text-accent" />;
    }
    return absoluteChange > 0 ? (
      <TrendingUp className="h-3.5 w-3.5 text-destructive" />
    ) : (
      <TrendingDown className="h-3.5 w-3.5 text-accent" />
    );
  };

  const getChangeColor = () => {
    if (!hasChange || absoluteChange === 0) return 'text-muted-foreground';
    if (isProblematic) return 'text-destructive';
    if (isPositive) return 'text-accent';
    return absoluteChange > 0 ? 'text-destructive' : 'text-accent';
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
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {getCategoryIcon()}
            <p className="truncate text-xs font-medium uppercase tracking-wide">
              {indicator.code.replace(/_/g, ' ')}
            </p>
          </div>
          <p className="mt-0.5 truncate text-sm text-foreground" title={indicator.name}>
            {indicator.name}
          </p>
        </div>
        {hasChange && (
          <div className="ml-2 shrink-0">
            {getTrendIcon()}
          </div>
        )}
      </div>

      {/* Values */}
      <div className="flex items-end gap-3">
        {/* Projected/Current Value */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {formatValue(projectedValue)}
          </span>
          <span className="text-xs text-muted-foreground">{indicator.unit}</span>
        </div>

        {/* Baseline comparison */}
        {isProjection && baselineValue !== null && (
          <div className="text-xs text-muted-foreground">
            (Baseline: {formatValue(baselineValue)})
          </div>
        )}
      </div>

      {/* Change indicator */}
      {hasChange && absoluteChange !== null && (
        <div className="mt-2 flex items-center gap-2">
          <span className={`text-sm font-semibold tabular-nums ${getChangeColor()}`}>
            {formatChange(absoluteChange)} {indicator.unit !== '%' ? indicator.unit : ''}
          </span>
          {relativeChange !== null && Math.abs(relativeChange) < 1000 && (
            <span className={`text-xs tabular-nums ${getChangeColor()} opacity-70`}>
              ({relativeChange > 0 ? '+' : ''}{relativeChange.toFixed(1)}%)
            </span>
          )}
          <span className="text-xs text-muted-foreground">vs. Baseline</span>
        </div>
      )}

      {/* Description tooltip area */}
      <p className="mt-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        {indicator.description}
      </p>
    </button>
  );
};

export default ClimateIndicatorCard;
