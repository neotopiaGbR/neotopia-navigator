import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Database, Clock, Play, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { ImportOverview } from '@/types/dataModule';

interface ImportOverviewCardsProps {
  overview: ImportOverview | undefined;
  isLoading: boolean;
}

export function ImportOverviewCards({ overview, isLoading }: ImportOverviewCardsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stats = overview || {
    total_products: 0,
    by_status: {} as Record<string, number>,
    readiness_percent: 0,
    latest_runs: [],
  };

  const byStatus = (stats.by_status || {}) as Record<string, number>;
  const queued = (byStatus['queued'] || 0) + (byStatus['pending'] || 0);
  const running = byStatus['running'] || 0;
  const loaded = byStatus['loaded'] || 0;
  const failed = (byStatus['failed'] || 0) + (byStatus['partial'] || 0);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Produkte gesamt</CardTitle>
          <Database className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.total_products}</div>
          <p className="text-xs text-muted-foreground">Registrierte Datenprodukte</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Warteschlange</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{queued}</div>
          <p className="text-xs text-muted-foreground">Jobs in Warteschlange</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Laufend</CardTitle>
          <Play className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-500">{running}</div>
          <p className="text-xs text-muted-foreground">Aktive Importe</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Geladen</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-500">{loaded}</div>
          <p className="text-xs text-muted-foreground">Erfolgreich importiert</p>
        </CardContent>
      </Card>

      <Card className={failed > 0 ? 'border-destructive/50' : ''}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">EU-Bereitschaft</CardTitle>
          {failed > 0 ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          )}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {stats.readiness_percent.toFixed(0)}%
          </div>
          <p className="text-xs text-muted-foreground">
            {failed > 0 ? `${failed} fehlgeschlagen` : 'Daten verfügbar'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
