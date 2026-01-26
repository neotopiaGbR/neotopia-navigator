import React from 'react';
import { useUsedDatasets } from '@/hooks/useDatasets';
import { ExternalLink, Database, Clock, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';

interface DataSourcesPanelProps {
  datasetsUsed: string[];
}

export function DataSourcesPanel({ datasetsUsed }: DataSourcesPanelProps) {
  const { data: usedDatasets, isLoading } = useUsedDatasets(datasetsUsed);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-3 p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (usedDatasets.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <Database className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Keine Datenquellen für die aktuelle Auswahl
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Verwendete Datenquellen ({usedDatasets.length})
          </p>
        </div>

        <div className="space-y-3">
          {usedDatasets.map((dataset) => (
            <div
              key={dataset.dataset_key}
              className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/30"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h4 className="truncate font-medium text-sm">{dataset.source}</h4>
                  <code className="text-xs text-muted-foreground">{dataset.dataset_key}</code>
                </div>
                {dataset.url && (
                  <a
                    href={dataset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-primary hover:text-primary/80"
                    title="Zur Datenquelle"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>

              <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                {dataset.attribution}
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-xs">
                  {dataset.license}
                </Badge>
                {dataset.coverage && (
                  <Badge variant="secondary" className="text-xs">
                    <MapPin className="mr-1 h-3 w-3" />
                    {dataset.coverage}
                  </Badge>
                )}
                {dataset.update_cycle && (
                  <Badge variant="secondary" className="text-xs">
                    <Clock className="mr-1 h-3 w-3" />
                    {dataset.update_cycle}
                  </Badge>
                )}
              </div>

              {dataset.license_url && (
                <a
                  href={dataset.license_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Lizenztext
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
