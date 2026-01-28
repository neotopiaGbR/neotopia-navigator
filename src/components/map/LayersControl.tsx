import React, { useState } from 'react';
import { Layers, Map, Satellite, Mountain, Flame, Droplets, X, Info, AlertCircle, ThermometerSun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useMapLayers, BasemapType, AggregationMethod } from './MapLayersContext';
import HeatLayerProvenancePanel from './HeatLayerProvenancePanel';

interface BasemapOption {
  id: BasemapType;
  label: string;
  icon: React.ReactNode;
  available: boolean;
}

const BASEMAP_OPTIONS: BasemapOption[] = [
  { id: 'map', label: 'Karte', icon: <Map className="h-4 w-4" />, available: true },
  { id: 'satellite', label: 'Satellit', icon: <Satellite className="h-4 w-4" />, available: true },
  { id: 'terrain', label: 'Gelände', icon: <Mountain className="h-4 w-4" />, available: false },
];

const OVERLAY_INFO = {
  ecostress: {
    name: 'Hitze-Hotspots – Sommer-Komposit',
    description: 'Aggregierte Sommerwärme: Globale Basis (MODIS 1km) + hochauflösendes ECOSTRESS-Komposit (70m)',
    attribution: 'NASA GIBS + LP DAAC / ECOSTRESS',
    doi: 'https://doi.org/10.5067/ECOSTRESS/ECO_L2T_LSTE.002',
    legendLabel: 'Oberflächentemperatur (°C)',
    legendColors: [
      { color: '#313695', label: '< 20°C' },
      { color: '#4575b4', label: '25°C' },
      { color: '#74add1', label: '30°C' },
      { color: '#abd9e9', label: '35°C' },
      { color: '#fee090', label: '40°C' },
      { color: '#fdae61', label: '45°C' },
      { color: '#f46d43', label: '50°C' },
      { color: '#d73027', label: '> 55°C' },
    ],
    tooltipNote: 'Diese Ebene zeigt aggregierte Sommerwärme (Juni–August). Es handelt sich nicht um eine Einzelaufnahme.',
  },
  floodRisk: {
    name: 'Hochwasser-Risiko (RP100)',
    description: 'Überschwemmungsgefährdung mit 100-jährlicher Wiederkehrperiode',
    attribution: 'JRC / Copernicus Emergency Management Service',
    doi: 'https://data.jrc.ec.europa.eu/collection/id-0054',
    legendLabel: 'Wassertiefe (m)',
    legendColors: [
      { color: '#c6dbef', label: '0.1 m' },
      { color: '#9ecae1', label: '0.5 m' },
      { color: '#6baed6', label: '1.0 m' },
      { color: '#4292c6', label: '2.0 m' },
      { color: '#2171b5', label: '3.0 m' },
      { color: '#08519c', label: '> 5.0 m' },
    ],
    disclaimer: 'Indikative Risikodarstellung. Für amtliche Hochwasserkarten lokale Behörden konsultieren.',
  },
};

// NearestCandidate and BestRejectedGranule interfaces moved to HeatLayerProvenancePanel


const LayersControl: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const {
    basemap,
    overlays,
    heatLayers,
    setBasemap,
    toggleOverlay,
    setOverlayOpacity,
    setHeatLayerOpacity,
    setAggregationMethod,
  } = useMapLayers();

  return (
    <div className="absolute left-3 bottom-8 z-10">
      {/* Layers Button */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'bg-background/90 backdrop-blur-sm border border-border shadow-lg',
          isOpen && 'bg-accent text-accent-foreground'
        )}
      >
        <Layers className="h-4 w-4 mr-1" />
        Ebenen
      </Button>

      {/* Layers Panel */}
      {isOpen && (
        <div className="absolute left-0 bottom-10 w-80 bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="text-sm font-semibold text-foreground">Kartenebenen</h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-4 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* Basemap Section */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Basiskarte
              </h4>
              <div className="grid grid-cols-3 gap-2">
                {BASEMAP_OPTIONS.map((option) => (
                  <Tooltip key={option.id}>
                    <TooltipTrigger asChild>
                      <button
                        disabled={!option.available}
                        onClick={() => option.available && setBasemap(option.id)}
                        className={cn(
                          'flex flex-col items-center gap-1 p-2 rounded-md border transition-all',
                          option.available
                            ? 'hover:bg-accent/50 cursor-pointer'
                            : 'opacity-50 cursor-not-allowed',
                          basemap === option.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-background/50'
                        )}
                      >
                        {option.icon}
                        <span className="text-xs">{option.label}</span>
                      </button>
                    </TooltipTrigger>
                    {!option.available && (
                      <TooltipContent>
                        <p>Demnächst verfügbar</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Overlays Section */}
            <div className="space-y-4">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Thematische Overlays
              </h4>

              {/* Heat Overlay (combined MODIS + ECOSTRESS Summer Composite) */}
              <HeatOverlayControl
                info={OVERLAY_INFO.ecostress}
                config={overlays.ecostress}
                heatLayers={heatLayers}
                onToggle={() => toggleOverlay('ecostress')}
                onGlobalOpacityChange={(val) => setHeatLayerOpacity('globalLST', val)}
                onEcostressOpacityChange={(val) => setHeatLayerOpacity('ecostress', val)}
                onAggregationMethodChange={setAggregationMethod}
              />

              {/* Flood Risk Overlay */}
              <OverlayControl
                id="floodRisk"
                icon={<Droplets className="h-4 w-4 text-blue-500" />}
                info={OVERLAY_INFO.floodRisk}
                config={overlays.floodRisk}
                onToggle={() => toggleOverlay('floodRisk')}
                onOpacityChange={(val) => setOverlayOpacity('floodRisk', val)}
              />
            </div>

            {/* Attribution Footer */}
            <div className="pt-3 border-t border-border">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Basiskarte: © CARTO / OpenStreetMap
                {overlays.ecostress.enabled && (
                  <>
                    <br />
                    ECOSTRESS: {OVERLAY_INFO.ecostress.attribution}
                  </>
                )}
                {overlays.floodRisk.enabled && (
                  <>
                    <br />
                    Hochwasser: {OVERLAY_INFO.floodRisk.attribution}
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// === HEAT OVERLAY CONTROL (Combined MODIS + ECOSTRESS Summer Composite) ===
interface HeatOverlayControlProps {
  info: typeof OVERLAY_INFO.ecostress;
  config: {
    enabled: boolean;
    opacity: number;
    loading: boolean;
    error: string | null;
    lastUpdated: string | null;
    metadata: Record<string, unknown>;
  };
  heatLayers: {
    globalLSTEnabled: boolean;
    globalLSTOpacity: number;
    ecostressEnabled: boolean;
    ecostressOpacity: number;
    ecostressMinCoverage: number;
    aggregationMethod: AggregationMethod;
  };
  onToggle: () => void;
  onGlobalOpacityChange: (value: number) => void;
  onEcostressOpacityChange: (value: number) => void;
  onAggregationMethodChange: (method: AggregationMethod) => void;
}

const HeatOverlayControl: React.FC<HeatOverlayControlProps> = ({
  info,
  config,
  heatLayers,
  onToggle,
  onGlobalOpacityChange,
  onEcostressOpacityChange,
  onAggregationMethodChange,
}) => {
  const [showLegend, setShowLegend] = useState(false);
  const [showProvenance, setShowProvenance] = useState(false);

  const ecostressStatus = config.metadata?.status as string | null;
  const hasEcostressMatch = ecostressStatus === 'match';
  const hasNoCoverage = ecostressStatus === 'no_coverage';
  
  const granuleCount = (config.metadata?.granuleCount as number) || (config.metadata?.allGranules as any[])?.length || 0;

  return (
    <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/20">
      {/* Header Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ThermometerSun className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-medium">{info.name}</span>
        </div>
        <Switch checked={config.enabled} onCheckedChange={onToggle} />
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground">{info.description}</p>

      {/* Error State */}
      {config.error && (
        <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{config.error}</span>
        </div>
      )}

      {/* Loading State */}
      {config.loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-3 w-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span>Lade ECOSTRESS-Aufnahmen...</span>
        </div>
      )}

      {/* Controls when enabled */}
      {config.enabled && !config.loading && (
        <div className="space-y-3 pt-2">
          {/* STATUS INDICATOR */}
          <div className={cn(
            'flex items-center gap-2 p-2 rounded text-xs',
            hasEcostressMatch 
              ? 'bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400' 
              : 'bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400'
          )}>
            {hasEcostressMatch ? (
              <>
                <Flame className="h-3 w-3" />
                <span>Sommer-Komposit aktiv ({granuleCount} Aufnahmen)</span>
              </>
            ) : (
              <>
                <Map className="h-3 w-3" />
                <span>Globale Wärmekarte aktiv (MODIS 1km)</span>
              </>
            )}
          </div>

          {/* ECOSTRESS not available message */}
          {hasNoCoverage && (
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs">
              <p className="text-amber-700 dark:text-amber-300">
                {String(config.metadata?.message || 'Kein hochauflösendes ECOSTRESS-Bild für diese Region verfügbar.')}
              </p>
              <p className="text-muted-foreground mt-1 text-[10px]">
                Die globale MODIS-Basiskarte zeigt dennoch Oberflächentemperaturen.
              </p>
            </div>
          )}

          {/* Aggregation Method Toggle */}
          {hasEcostressMatch && (
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Aggregationsmethode:</span>
              <div className="flex gap-2">
                <button
                  onClick={() => onAggregationMethodChange('median')}
                  className={cn(
                    'flex-1 px-2 py-1.5 text-xs rounded border transition-colors',
                    heatLayers.aggregationMethod === 'median'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-muted'
                  )}
                >
                  Median
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onAggregationMethodChange('p90')}
                      className={cn(
                        'flex-1 px-2 py-1.5 text-xs rounded border transition-colors',
                        heatLayers.aggregationMethod === 'p90'
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-background border-border hover:bg-muted'
                      )}
                    >
                      P90
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-[200px]">
                      90. Perzentil zeigt extreme Hitze-Hotspots
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onAggregationMethodChange('max')}
                      className={cn(
                        'flex-1 px-2 py-1.5 text-xs rounded border transition-colors',
                        heatLayers.aggregationMethod === 'max'
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-background border-border hover:bg-muted'
                      )}
                    >
                      Max
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-[200px]">
                      Maximum zeigt die heißesten gemessenen Werte
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}

          {/* Opacity Controls */}
          <div className="space-y-3">
            {/* Global LST Opacity */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Globale Basis (MODIS)</span>
                <span className="text-xs font-mono text-muted-foreground">{heatLayers.globalLSTOpacity}%</span>
              </div>
              <Slider
                value={[heatLayers.globalLSTOpacity]}
                min={0}
                max={100}
                step={5}
                onValueChange={([val]) => onGlobalOpacityChange(val)}
                className="w-full"
              />
            </div>

            {/* ECOSTRESS Composite Opacity (only when match) */}
            {hasEcostressMatch && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Sommer-Komposit (ECOSTRESS)</span>
                  <span className="text-xs font-mono text-muted-foreground">{heatLayers.ecostressOpacity}%</span>
                </div>
                <Slider
                  value={[heatLayers.ecostressOpacity]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={([val]) => onEcostressOpacityChange(val)}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* Legend Toggle */}
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Info className="h-3 w-3" />
            {showLegend ? 'Legende ausblenden' : 'Legende anzeigen'}
          </button>

          {/* Legend */}
          {showLegend && (
            <div className="p-2 rounded bg-background/80 border border-border space-y-2">
              <span className="text-xs font-medium">{info.legendLabel}</span>
              <div className="flex flex-wrap gap-1">
                {info.legendColors.map((item, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <div
                      className="w-4 h-3 rounded-sm border border-border/50"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-[10px] text-muted-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Provenance Toggle */}
          <button
            onClick={() => setShowProvenance(!showProvenance)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Layers className="h-3 w-3" />
            {showProvenance ? 'Datenquellen ausblenden' : 'Datenquellen anzeigen'}
          </button>

          {/* Data Provenance Panel */}
          {showProvenance && (
            <HeatLayerProvenancePanel
              visible={true}
              ecostressEnabled={heatLayers.ecostressEnabled}
              ecostressMetadata={{
                status: ecostressStatus as 'match' | 'no_coverage' | 'loading' | null,
                cogUrl: config.metadata?.cogUrl as string | undefined,
                acquisitionDatetime: config.metadata?.acquisitionDatetime as string | undefined,
                granuleId: config.metadata?.granuleId as string | undefined,
                qualityScore: config.metadata?.qualityScore as number | undefined,
                coveragePercent: config.metadata?.coveragePercent as number | undefined,
                cloudPercent: config.metadata?.cloudPercent as number | undefined,
                candidatesChecked: config.metadata?.candidatesChecked as number | undefined,
                message: config.metadata?.message as string | undefined,
                bestRejected: config.metadata?.bestRejected as any,
                // Summer composite fields
                granuleCount: granuleCount,
                successfulGranules: config.metadata?.successfulGranules as number | undefined,
                discardedGranules: config.metadata?.discardedGranules as number | undefined,
                aggregationMethod: heatLayers.aggregationMethod,
                timeWindow: config.metadata?.timeWindow as { from: string; to: string } | undefined,
                coverageConfidence: config.metadata?.coverageConfidence as any,
                p5Temp: config.metadata?.p5Temp as number | undefined,
                p95Temp: config.metadata?.p95Temp as number | undefined,
              }}
              ecostressLoading={config.loading}
              globalLSTOpacity={heatLayers.globalLSTOpacity}
              ecostressOpacity={heatLayers.ecostressOpacity}
              aggregationMethod={heatLayers.aggregationMethod}
            />
          )}

          {/* Summer composite info */}
          {hasEcostressMatch && (
            <div className="text-[10px] text-muted-foreground/70 space-y-1">
              <p>
                Sommer-Komposit: {granuleCount} Aufnahmen 
                ({heatLayers.aggregationMethod === 'p90' ? '90. Perzentil' : 'Median'})
              </p>
              {info.tooltipNote && (
                <p className="italic">{info.tooltipNote}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// === FLOOD RISK OVERLAY CONTROL ===
interface OverlayControlProps {
  id: 'ecostress' | 'floodRisk';
  icon: React.ReactNode;
  info: typeof OVERLAY_INFO.ecostress | typeof OVERLAY_INFO.floodRisk;
  config: {
    enabled: boolean;
    opacity: number;
    loading: boolean;
    error: string | null;
    lastUpdated: string | null;
    metadata: Record<string, unknown>;
  };
  onToggle: () => void;
  onOpacityChange: (value: number) => void;
}

const OverlayControl: React.FC<OverlayControlProps> = ({
  id,
  icon,
  info,
  config,
  onToggle,
  onOpacityChange,
}) => {
  const [showLegend, setShowLegend] = useState(false);

  return (
    <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/20">
      {/* Header Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{info.name}</span>
        </div>
        <Switch checked={config.enabled} onCheckedChange={onToggle} />
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground">{info.description}</p>

      {/* Error State */}
      {config.error && (
        <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{config.error}</span>
        </div>
      )}

      {/* Loading State */}
      {config.loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-3 w-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span>Lade Daten...</span>
        </div>
      )}

      {/* Controls (when enabled) */}
      {config.enabled && !config.loading && (
        <div className="space-y-3 pt-2">
          {/* Opacity Slider */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Deckkraft</span>
              <span className="text-xs font-mono text-muted-foreground">{config.opacity}%</span>
            </div>
            <Slider
              value={[config.opacity]}
              min={0}
              max={100}
              step={5}
              onValueChange={([val]) => onOpacityChange(val)}
              className="w-full"
            />
          </div>

          {/* Legend Toggle */}
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Info className="h-3 w-3" />
            {showLegend ? 'Legende ausblenden' : 'Legende anzeigen'}
          </button>

          {/* Legend */}
          {showLegend && (
            <div className="p-2 rounded bg-background/80 border border-border space-y-2">
              <span className="text-xs font-medium">{info.legendLabel}</span>
              <div className="flex flex-wrap gap-1">
                {info.legendColors.map((item, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <div
                      className="w-4 h-3 rounded-sm border border-border/50"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-[10px] text-muted-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
              {'disclaimer' in info && (
                <p className="text-[10px] text-muted-foreground/80 italic mt-1">
                  {(info as typeof OVERLAY_INFO.floodRisk).disclaimer}
                </p>
              )}
            </div>
          )}

          {/* Layer count (flood risk) */}
          {id === 'floodRisk' && config.metadata?.layers && (
            <div className="p-2 rounded bg-blue-500/10 border border-blue-500/30 text-xs">
              <p className="text-blue-600 dark:text-blue-400 font-medium">
                ✓ {(config.metadata.layers as any[]).length} Layer geladen
              </p>
              {config.metadata.message && (
                <p className="text-muted-foreground mt-1">{String(config.metadata.message)}</p>
              )}
            </div>
          )}

          {/* Timestamp */}
          {config.lastUpdated && (
            <p className="text-[10px] text-muted-foreground">
              Aktualisiert:{' '}
              {new Date(config.lastUpdated).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default LayersControl;
