import React from 'react';
import { useRegion } from '@/contexts/RegionContext';
import { MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const RegionSidebar: React.FC = () => {
  const { selectedRegion, setSelectedRegionId, regions } = useRegion();

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MapPin className="h-4 w-4 text-accent" />
          Regionen
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {regions.length} Region{regions.length !== 1 ? 'en' : ''} geladen
        </p>
      </div>

      {selectedRegion ? (
        <div className="flex-1 p-4">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Ausgewählt
              </p>
              <h3 className="mt-1 text-lg font-bold text-accent">
                {selectedRegion.name}
              </h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedRegionId(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="rounded-lg border border-dashed border-accent/50 p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Indikatoren werden hier angezeigt
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-sm text-muted-foreground">
            Klicken Sie auf eine Region, um Details anzuzeigen
          </p>
        </div>
      )}
    </div>
  );
};

export default RegionSidebar;
