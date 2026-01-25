import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { Slider } from '@/components/ui/slider';
import { RegionIndicatorData } from '@/hooks/useRegionIndicators';
import { TrendingUp, TrendingDown, Minus, Calendar } from 'lucide-react';

interface IndicatorChartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: RegionIndicatorData | null;
  regionName: string | null;
}

const IndicatorChartDialog: React.FC<IndicatorChartDialogProps> = ({
  open,
  onOpenChange,
  data,
  regionName,
}) => {
  // Year range state
  const [yearRange, setYearRange] = useState<[number, number]>([0, 0]);

  // Get min/max years from data
  const yearBounds = useMemo(() => {
    if (!data || data.values.length === 0) return { min: 0, max: 0 };
    const years = data.values.map((v) => v.year);
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [data]);

  // Reset year range when data changes
  useEffect(() => {
    if (yearBounds.min && yearBounds.max) {
      setYearRange([yearBounds.min, yearBounds.max]);
    }
  }, [yearBounds.min, yearBounds.max]);

  // Filter values based on year range
  const filteredValues = useMemo(() => {
    if (!data) return [];
    return data.values.filter((v) => v.year >= yearRange[0] && v.year <= yearRange[1]);
  }, [data, yearRange]);

  if (!data) return null;

  const { indicator } = data;

  // Calculate statistics from filtered values
  const stats = useMemo(() => {
    if (filteredValues.length === 0) {
      return { min: 0, max: 0, latest: 0, latestYear: null, firstYear: null };
    }
    const values = filteredValues.map((v) => v.value);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      latest: filteredValues[filteredValues.length - 1].value,
      latestYear: filteredValues[filteredValues.length - 1].year,
      firstYear: filteredValues[0].year,
    };
  }, [filteredValues]);

  // Calculate trend percentage from filtered data
  const trend = useMemo(() => {
    if (filteredValues.length < 2) return { value: 0, direction: 'neutral' as const };
    const first = filteredValues[0].value;
    const last = filteredValues[filteredValues.length - 1].value;
    if (first === 0) return { value: 0, direction: 'neutral' as const };
    const percent = ((last - first) / Math.abs(first)) * 100;
    return {
      value: Math.abs(percent),
      direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'neutral',
    } as { value: number; direction: 'up' | 'down' | 'neutral' };
  }, [filteredValues]);

  const formatValue = (value: number): string => {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(2)}M`;
    }
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(2)}K`;
    }
    return value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  };

  const formatAxisValue = (value: number): string => {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="rounded-md border border-border bg-card px-3 py-2 shadow-lg">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-lg font-bold tabular-nums text-foreground">
          {formatValue(payload[0].value)}{' '}
          <span className="text-xs font-normal text-muted-foreground">
            {indicator.unit}
          </span>
        </p>
      </div>
    );
  };

  const handleYearRangeChange = (values: number[]) => {
    if (values.length === 2) {
      setYearRange([values[0], values[1]]);
    }
  };

  const isFiltered = yearRange[0] !== yearBounds.min || yearRange[1] !== yearBounds.max;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-border bg-background">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-accent">
                {indicator.code}
              </p>
              <DialogTitle className="mt-1 text-xl font-bold text-foreground">
                {indicator.name}
              </DialogTitle>
              {regionName && (
                <p className="mt-1 text-sm text-muted-foreground">{regionName}</p>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Year Range Slider */}
        {yearBounds.max > yearBounds.min && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Zeitraum</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-accent/20 px-2 py-0.5 text-sm font-bold tabular-nums text-accent">
                  {yearRange[0]}
                </span>
                <span className="text-xs text-muted-foreground">bis</span>
                <span className="rounded bg-accent/20 px-2 py-0.5 text-sm font-bold tabular-nums text-accent">
                  {yearRange[1]}
                </span>
                {isFiltered && (
                  <button
                    onClick={() => setYearRange([yearBounds.min, yearBounds.max])}
                    className="ml-2 text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    Zurücksetzen
                  </button>
                )}
              </div>
            </div>
            <Slider
              value={yearRange}
              onValueChange={handleYearRangeChange}
              min={yearBounds.min}
              max={yearBounds.max}
              step={1}
              className="w-full"
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>{yearBounds.min}</span>
              <span>{yearBounds.max}</span>
            </div>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Aktuell</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
              {formatValue(stats.latest)}
            </p>
            <p className="text-xs text-muted-foreground">{stats.latestYear}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Trend</p>
            <div className="mt-1 flex items-center gap-1">
              {trend.direction === 'up' ? (
                <TrendingUp className="h-4 w-4 text-accent" />
              ) : trend.direction === 'down' ? (
                <TrendingDown className="h-4 w-4 text-destructive" />
              ) : (
                <Minus className="h-4 w-4 text-muted-foreground" />
              )}
              <span
                className={`text-lg font-bold tabular-nums ${
                  trend.direction === 'up'
                    ? 'text-accent'
                    : trend.direction === 'down'
                    ? 'text-destructive'
                    : 'text-foreground'
                }`}
              >
                {trend.value.toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.firstYear}–{stats.latestYear}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Minimum</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
              {formatValue(stats.min)}
            </p>
            <p className="text-xs text-muted-foreground">{indicator.unit}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Maximum</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
              {formatValue(stats.max)}
            </p>
            <p className="text-xs text-muted-foreground">{indicator.unit}</p>
          </div>
        </div>

        {/* Chart */}
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={filteredValues}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                tickFormatter={formatAxisValue}
                width={50}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--accent))"
                strokeWidth={2}
                fill="url(#colorValue)"
                dot={false}
                activeDot={{
                  r: 5,
                  fill: 'hsl(var(--accent))',
                  stroke: 'hsl(var(--background))',
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Data Table */}
        <div className="mt-4 max-h-32 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Jahr
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                  Wert ({indicator.unit})
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                  Δ Vorjahr
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredValues
                .slice()
                .reverse()
                .map((v, i, arr) => {
                  const prevValue = arr[i + 1]?.value;
                  const delta = prevValue !== undefined ? v.value - prevValue : null;
                  return (
                    <tr key={v.year} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">
                        {v.year}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {formatValue(v.value)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          delta === null
                            ? 'text-muted-foreground'
                            : delta > 0
                            ? 'text-accent'
                            : delta < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {delta === null
                          ? '—'
                          : `${delta > 0 ? '+' : ''}${formatValue(delta)}`}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default IndicatorChartDialog;
