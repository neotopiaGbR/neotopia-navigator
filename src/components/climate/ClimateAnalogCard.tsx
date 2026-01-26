import React from 'react';
import { ClimateAnalogResult } from './types';
import { MapPin, Compass, Info } from 'lucide-react';

interface ClimateAnalogCardProps {
  result: ClimateAnalogResult;
}

const ClimateAnalogCard: React.FC<ClimateAnalogCardProps> = ({ result }) => {
  const { analogLocation, similarityScore, description } = result;

  if (!analogLocation) {
    return (
      <div className="rounded-md border border-border bg-card/50 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-muted p-2">
            <Compass className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-foreground">Klimaanalogie</h4>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-accent/30 bg-gradient-to-br from-accent/10 to-transparent p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-accent/20 p-2">
          <MapPin className="h-5 w-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-foreground">Klimaanalogie: Rom-Effekt</h4>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold text-accent">{analogLocation.name}</span>
            <span className="text-sm text-muted-foreground">({analogLocation.country})</span>
          </div>
          {similarityScore !== null && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Ähnlichkeit</span>
                <span className="font-medium text-foreground">{similarityScore}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${similarityScore}%` }}
                />
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{description}</p>
          <div className="mt-3 flex items-start gap-1.5 rounded bg-muted/50 p-2">
            <Info className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Diese Projektion hilft bei der Planung von Beschattung, blau-grüner Infrastruktur und urbaner Hitzeminderung.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClimateAnalogCard;
