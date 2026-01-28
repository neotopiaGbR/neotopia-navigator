import React, { useState } from 'react';
import { Layers, Map, Satellite, Mountain, Flame, Droplets, X, Info, AlertCircle, MapPin, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useMapLayers, BasemapType } from './MapLayersContext';

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
    name: 'Hitze-Hotspots (ECOSTRESS LST)',
    description: 'Oberflächentemperatur aus NASA ECOSTRESS (~70m Auflösung)',
    attribution: 'NASA LP DAAC / ECOSTRESS',
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

interface NearestCandidate {
  granule_id: string;
  datetime: string;
  bounds: [number, number, number, number];
  distance_km: number;
  cloud_cover?: number;
}

interface BestRejectedGranule {
  granule_id: string;
  datetime: string;
  quality_score: number;
  coverage_percent: number;
  cloud_percent: number;
}

const LayersControl: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const {
    basemap,
    overlays,
    setBasemap,
    toggleOverlay,
    setOverlayOpacity,
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
                Overlays
              </h4>

              {/* ECOSTRESS Overlay */}
              <OverlayControl
                id="ecostress"
                icon={<Flame className="h-4 w-4 text-orange-500" />}
                info={OVERLAY_INFO.ecostress}
                config={overlays.ecostress}
                onToggle={() => toggleOverlay('ecostress')}
                onOpacityChange={(val) => setOverlayOpacity('ecostress', val)}
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
  const [showBoundary, setShowBoundary] = useState(false);

  // Check ECOSTRESS status from metadata
  const ecostressStatus = id === 'ecostress' ? (config.metadata?.status as string) : null;
  const isNoCoverage = ecostressStatus === 'no_coverage';
  const isMatch = ecostressStatus === 'match';
  const nearestCandidate = config.metadata?.nearestCandidate as NearestCandidate | null;
  const bestRejected = config.metadata?.bestRejected as BestRejectedGranule | null;
  
  // Quality metrics for match state
  const qualityScore = config.metadata?.qualityScore as number | undefined;
  const coveragePercent = config.metadata?.coveragePercent as number | undefined;
  const cloudPercent = config.metadata?.cloudPercent as number | undefined;
  const candidatesChecked = config.metadata?.candidatesChecked as number | undefined;

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
          {/* ECOSTRESS: No Coverage State */}
          {id === 'ecostress' && isNoCoverage && (
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="text-amber-700 dark:text-amber-300 font-medium">
                  Keine ausreichende Abdeckung
                </p>
              </div>
              <p className="text-muted-foreground">
                {String(config.metadata?.message || 'Keine ECOSTRESS-Aufnahme für diese Region im letzten Jahr verfügbar.')}
              </p>
              
              {/* Best rejected granule (quality too low) */}
              {bestRejected && (
                <div className="mt-2 p-2 rounded bg-background/80 border border-border space-y-1">
                  <p className="text-muted-foreground font-medium">Beste verfügbare Aufnahme:</p>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                    <span className="text-muted-foreground">Qualität:</span>
                    <span className="font-mono">{Math.round(bestRejected.quality_score * 100)}%</span>
                    <span className="text-muted-foreground">Abdeckung:</span>
                    <span className="font-mono">{bestRejected.coverage_percent}%</span>
                    <span className="text-muted-foreground">Bewölkung:</span>
                    <span className="font-mono">{bestRejected.cloud_percent}%</span>
                    <span className="text-muted-foreground">Datum:</span>
                    <span>{new Date(bestRejected.datetime).toLocaleDateString('de-DE')}</span>
                  </div>
                </div>
              )}
              
              {/* Nearest capture hint (no intersection) */}
              {nearestCandidate && !bestRejected && (
                <div className="mt-2 p-2 rounded bg-background/80 border border-border space-y-1">
                  <p className="text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Nächste Aufnahme: <strong>{nearestCandidate.distance_km} km</strong> entfernt
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">
                    {new Date(nearestCandidate.datetime).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                    {nearestCandidate.cloud_cover != null && ` • Bewölkung: ${nearestCandidate.cloud_cover}%`}
                  </p>
                  <button
                    onClick={() => setShowBoundary(!showBoundary)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                  >
                    {showBoundary ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showBoundary ? 'Footprint ausblenden' : 'Footprint anzeigen'}
                  </button>
                </div>
              )}
              
              {/* Candidates checked info */}
              {candidatesChecked != null && (
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  {candidatesChecked} Aufnahmen geprüft
                </p>
              )}
            </div>
          )}

          {/* ECOSTRESS: Match State - Show overlay controls */}
          {id === 'ecostress' && isMatch && (
            <>
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

              {/* Show boundary toggle */}
              <button
                onClick={() => setShowBoundary(!showBoundary)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showBoundary ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {showBoundary ? 'Kachel-Grenze ausblenden' : 'Kachel-Grenze anzeigen'}
              </button>

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

              {/* Match info with quality metrics */}
              <div className="p-2 rounded bg-green-500/10 border border-green-500/30 text-xs space-y-2">
                <p className="text-green-600 dark:text-green-400 font-medium">✓ Beste Aufnahme ausgewählt</p>
                
                {/* Quality metrics grid */}
                {(qualityScore != null || coveragePercent != null) && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                    {qualityScore != null && (
                      <>
                        <span className="text-muted-foreground">Qualität:</span>
                        <span className="font-mono font-medium">{Math.round(qualityScore * 100)}%</span>
                      </>
                    )}
                    {coveragePercent != null && (
                      <>
                        <span className="text-muted-foreground">Abdeckung:</span>
                        <span className="font-mono">{coveragePercent}%</span>
                      </>
                    )}
                    {cloudPercent != null && (
                      <>
                        <span className="text-muted-foreground">Bewölkung:</span>
                        <span className="font-mono">{cloudPercent}%</span>
                      </>
                    )}
                  </div>
                )}
                
                {/* Acquisition date */}
                {config.metadata?.acquisitionDatetime && (
                  <p className="text-muted-foreground">
                    Aufnahme: {new Date(String(config.metadata.acquisitionDatetime)).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                )}
                
                {/* Candidates checked */}
                {candidatesChecked != null && (
                  <p className="text-[10px] text-muted-foreground/60">
                    Ausgewählt aus {candidatesChecked} Aufnahmen
                  </p>
                )}
              </div>
            </>
          )}

          {/* Flood Risk controls */}
          {id === 'floodRisk' && (
            <>
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
                      {info.disclaimer}
                    </p>
                  )}
                </div>
              )}

              {/* Layer count */}
              {config.metadata?.layers && (
                <div className="p-2 rounded bg-blue-500/10 border border-blue-500/30 text-xs">
                  <p className="text-blue-600 dark:text-blue-400 font-medium">
                    ✓ {(config.metadata.layers as any[]).length} Layer geladen
                  </p>
                  {config.metadata.message && (
                    <p className="text-muted-foreground mt-1">{String(config.metadata.message)}</p>
                  )}
                </div>
              )}
            </>
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
