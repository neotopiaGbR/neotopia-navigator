/**
 * Heat Layer Data Provenance Panel
 * 
 * Shows detailed information about active heat layers:
 * - Base layer (MODIS/VIIRS) - always active
 * - High-res overlay (ECOSTRESS) - when available
 * - Coverage, quality metrics, and acquisition dates
 */

import React from 'react';
import { AlertCircle, CheckCircle, Info, Layers, ThermometerSun, Satellite, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GLOBAL_LST_INFO } from './GlobalLSTOverlay';

interface EcostressMetadata {
  status: 'match' | 'no_coverage' | 'loading' | null;
  cogUrl?: string;
  acquisitionDatetime?: string;
  granuleId?: string;
  qualityScore?: number;
  coveragePercent?: number;
  cloudPercent?: number;
  candidatesChecked?: number;
  message?: string;
  bestRejected?: {
    quality_score: number;
    coverage_percent: number;
    cloud_percent: number;
    datetime: string;
  };
}

interface HeatLayerProvenancePanelProps {
  visible: boolean;
  ecostressEnabled: boolean;
  ecostressMetadata: EcostressMetadata | null;
  ecostressLoading: boolean;
  globalLSTOpacity: number;
  ecostressOpacity: number;
}

const HeatLayerProvenancePanel: React.FC<HeatLayerProvenancePanelProps> = ({
  visible,
  ecostressEnabled,
  ecostressMetadata,
  ecostressLoading,
  globalLSTOpacity,
  ecostressOpacity,
}) => {
  if (!visible) return null;

  const hasEcostressMatch = ecostressMetadata?.status === 'match';
  const hasNoCoverage = ecostressMetadata?.status === 'no_coverage';

  return (
    <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Aktive Datenquellen
        </span>
      </div>

      {/* TIER 1: Global Base Layer (always active) */}
      <LayerInfo
        tier={1}
        icon={<Globe className="h-4 w-4 text-blue-500" />}
        title="Globale Wärmekarte (Basis)"
        source={GLOBAL_LST_INFO.source}
        resolution={GLOBAL_LST_INFO.resolution}
        coverage="100%"
        temporalInfo={GLOBAL_LST_INFO.temporalResolution}
        opacity={globalLSTOpacity}
        status="active"
        statusText="Immer aktiv"
        attribution={GLOBAL_LST_INFO.attribution}
      />

      {/* TIER 2: ECOSTRESS High-Res Overlay */}
      {ecostressEnabled && (
        <>
          <div className="border-t border-border/50" />
          
          {ecostressLoading ? (
            <LayerInfo
              tier={2}
              icon={<Satellite className="h-4 w-4 text-orange-500" />}
              title="Hochauflösende Details (ECOSTRESS)"
              source="NASA ECOSTRESS"
              resolution="~70m"
              status="loading"
              statusText="Suche beste Aufnahme..."
            />
          ) : hasEcostressMatch ? (
            <LayerInfo
              tier={2}
              icon={<Satellite className="h-4 w-4 text-orange-500" />}
              title="Hochauflösende Details (ECOSTRESS)"
              source="NASA ECOSTRESS LST"
              resolution="~70m"
              coverage={`${ecostressMetadata.coveragePercent ?? 0}%`}
              temporalInfo={
                ecostressMetadata.acquisitionDatetime
                  ? formatAcquisitionDate(ecostressMetadata.acquisitionDatetime)
                  : 'Unbekannt'
              }
              opacity={ecostressOpacity}
              qualityScore={ecostressMetadata.qualityScore}
              cloudPercent={ecostressMetadata.cloudPercent}
              status="active"
              statusText="Aktiv"
              attribution="NASA LP DAAC / ECOSTRESS"
            />
          ) : hasNoCoverage ? (
            <LayerInfo
              tier={2}
              icon={<Satellite className="h-4 w-4 text-muted-foreground" />}
              title="Hochauflösende Details (ECOSTRESS)"
              source="NASA ECOSTRESS"
              resolution="~70m"
              status="unavailable"
              statusText="Nicht verfügbar"
              message={ecostressMetadata.message || 'Keine ausreichende Abdeckung für diese Region.'}
              bestRejected={ecostressMetadata.bestRejected}
              candidatesChecked={ecostressMetadata.candidatesChecked}
            />
          ) : (
            <LayerInfo
              tier={2}
              icon={<Satellite className="h-4 w-4 text-muted-foreground" />}
              title="Hochauflösende Details (ECOSTRESS)"
              source="NASA ECOSTRESS"
              resolution="~70m"
              status="unavailable"
              statusText="Region auswählen"
              message="Wählen Sie eine Region auf der Karte aus, um hochauflösende ECOSTRESS-Daten zu laden."
            />
          )}
        </>
      )}

      {/* Info note when ECOSTRESS not available but enabled */}
      {ecostressEnabled && hasNoCoverage && (
        <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
          <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            Die globale MODIS-Basiskarte bleibt sichtbar. Hochauflösende ECOSTRESS-Daten 
            werden nur angezeigt, wenn eine qualitativ ausreichende Aufnahme für diese Region existiert.
          </p>
        </div>
      )}
    </div>
  );
};

interface LayerInfoProps {
  tier: 1 | 2 | 3;
  icon: React.ReactNode;
  title: string;
  source: string;
  resolution: string;
  coverage?: string;
  temporalInfo?: string;
  opacity?: number;
  qualityScore?: number;
  cloudPercent?: number;
  status: 'active' | 'loading' | 'unavailable';
  statusText: string;
  message?: string;
  attribution?: string;
  bestRejected?: {
    quality_score: number;
    coverage_percent: number;
    cloud_percent: number;
    datetime: string;
  };
  candidatesChecked?: number;
}

const LayerInfo: React.FC<LayerInfoProps> = ({
  tier,
  icon,
  title,
  source,
  resolution,
  coverage,
  temporalInfo,
  opacity,
  qualityScore,
  cloudPercent,
  status,
  statusText,
  message,
  attribution,
  bestRejected,
  candidatesChecked,
}) => {
  const statusConfig = {
    active: { icon: <CheckCircle className="h-3 w-3" />, color: 'text-green-500', bg: 'bg-green-500/10' },
    loading: { icon: <div className="h-3 w-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />, color: 'text-primary', bg: 'bg-primary/10' },
    unavailable: { icon: <AlertCircle className="h-3 w-3" />, color: 'text-muted-foreground', bg: 'bg-muted/50' },
  };

  const cfg = statusConfig[status];

  return (
    <div className={cn('p-2.5 rounded-md border', status === 'active' ? 'border-green-500/30 bg-green-500/5' : 'border-border/50 bg-background/50')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-medium text-foreground">{title}</span>
        </div>
        <div className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]', cfg.bg, cfg.color)}>
          {cfg.icon}
          <span>{statusText}</span>
        </div>
      </div>

      {/* Details Grid */}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        <span className="text-muted-foreground">Quelle:</span>
        <span className="text-foreground">{source}</span>
        
        <span className="text-muted-foreground">Auflösung:</span>
        <span className="text-foreground">{resolution}</span>

        {coverage && (
          <>
            <span className="text-muted-foreground">Abdeckung:</span>
            <span className="text-foreground">{coverage}</span>
          </>
        )}

        {temporalInfo && (
          <>
            <span className="text-muted-foreground">Zeitraum:</span>
            <span className="text-foreground">{temporalInfo}</span>
          </>
        )}

        {qualityScore != null && (
          <>
            <span className="text-muted-foreground">Qualität:</span>
            <span className="text-foreground font-medium">{Math.round(qualityScore * 100)}%</span>
          </>
        )}

        {cloudPercent != null && (
          <>
            <span className="text-muted-foreground">Bewölkung:</span>
            <span className="text-foreground">{cloudPercent}%</span>
          </>
        )}

        {opacity != null && (
          <>
            <span className="text-muted-foreground">Deckkraft:</span>
            <span className="text-foreground">{opacity}%</span>
          </>
        )}
      </div>

      {/* Unavailable message */}
      {message && status === 'unavailable' && (
        <p className="mt-2 text-[10px] text-muted-foreground">{message}</p>
      )}

      {/* Best rejected granule info */}
      {bestRejected && (
        <div className="mt-2 p-1.5 rounded bg-muted/50 border border-border/50">
          <p className="text-[10px] text-muted-foreground font-medium">Beste verfügbare Aufnahme:</p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] mt-1">
            <span className="text-muted-foreground">Qualität:</span>
            <span>{Math.round(bestRejected.quality_score * 100)}%</span>
            <span className="text-muted-foreground">Abdeckung:</span>
            <span>{bestRejected.coverage_percent}%</span>
            <span className="text-muted-foreground">Datum:</span>
            <span>{new Date(bestRejected.datetime).toLocaleDateString('de-DE')}</span>
          </div>
        </div>
      )}

      {/* Candidates checked */}
      {candidatesChecked != null && (
        <p className="mt-1 text-[9px] text-muted-foreground/60">
          {candidatesChecked} Aufnahmen geprüft
        </p>
      )}

      {/* Attribution */}
      {attribution && (
        <p className="mt-1.5 text-[9px] text-muted-foreground/50">{attribution}</p>
      )}
    </div>
  );
};

function formatAcquisitionDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    const formatted = date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    
    if (diffDays === 0) return `${formatted} (heute)`;
    if (diffDays === 1) return `${formatted} (gestern)`;
    if (diffDays < 7) return `${formatted} (vor ${diffDays} Tagen)`;
    if (diffDays < 30) return `${formatted} (vor ${Math.floor(diffDays / 7)} Wochen)`;
    return `${formatted} (vor ${Math.floor(diffDays / 30)} Monaten)`;
  } catch {
    return dateStr;
  }
}

export default HeatLayerProvenancePanel;
