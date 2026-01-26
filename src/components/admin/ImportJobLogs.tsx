import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useImportJob, useImportJobLogs, useRunImportJob, useSetImportJobStatus } from '@/hooks/useImportSystem';
import { AlertCircle, CheckCircle2, Info, RefreshCw, Play, XCircle, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { LogLevel, ImportJobStatus } from '@/types/dataModule';

function LogLevelIcon({ level }: { level: LogLevel }) {
  switch (level) {
    case 'info':
      return <Info className="h-4 w-4 text-blue-500" />;
    case 'warn':
      return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />;
    default:
      return null;
  }
}

function StatusBadge({ status }: { status: ImportJobStatus }) {
  const config: Record<ImportJobStatus, { className: string; label: string }> = {
    pending: { className: 'bg-gray-500', label: 'Ausstehend' },
    queued: { className: 'bg-gray-500', label: 'Warteschlange' },
    running: { className: 'bg-blue-500', label: 'Läuft' },
    loaded: { className: 'bg-green-600', label: 'Geladen' },
    failed: { className: 'bg-destructive', label: 'Fehlgeschlagen' },
    partial: { className: 'bg-yellow-500', label: 'Teilweise' },
  };

  const { className, label } = config[status] || config.pending;

  return (
    <Badge className={className}>
      {status === 'running' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {label}
    </Badge>
  );
}

interface ImportJobLogsProps {
  jobId: string;
  onClose?: () => void;
}

export function ImportJobLogs({ jobId, onClose }: ImportJobLogsProps) {
  const { data: job, isLoading: jobLoading } = useImportJob(jobId);
  const { data: logs, isLoading: logsLoading } = useImportJobLogs(jobId);
  const runJob = useRunImportJob();
  const setStatus = useSetImportJobStatus();

  const handleRetry = async () => {
    if (!job) return;
    try {
      // Reset to queued then run
      await setStatus.mutateAsync({ job_id: jobId, status: 'queued' });
      await runJob.mutateAsync(jobId);
      toast({ title: 'Import neu gestartet' });
    } catch (error) {
      toast({
        title: 'Fehler',
        description: 'Import konnte nicht neu gestartet werden.',
        variant: 'destructive',
      });
    }
  };

  if (jobLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!job) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Job nicht gefunden.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">
            {job.product?.name || 'Unbekanntes Produkt'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Job ID: <code>{job.id.slice(0, 8)}...</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          {(job.status === 'failed' || job.status === 'partial') && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={runJob.isPending}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              Wiederholen
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Job Details */}
        <div className="grid gap-4 sm:grid-cols-3 text-sm">
          <div>
            <span className="text-muted-foreground">Scope:</span>{' '}
            <span className="font-medium">{job.scope}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Gestartet:</span>{' '}
            <span className="font-medium">
              {job.started_at
                ? new Date(job.started_at).toLocaleString('de-DE')
                : '–'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Beendet:</span>{' '}
            <span className="font-medium">
              {job.finished_at
                ? new Date(job.finished_at).toLocaleString('de-DE')
                : '–'}
            </span>
          </div>
        </div>

        {/* Error Message */}
        {job.error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <strong>Fehler:</strong> {job.error}
          </div>
        )}

        {/* Rows Loaded */}
        {job.rows_loaded !== null && job.rows_loaded > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>{job.rows_loaded.toLocaleString('de-DE')} Zeilen geladen</span>
          </div>
        )}

        {/* Raw Artifacts */}
        {job.raw_artifacts && job.raw_artifacts.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">Artefakte:</h4>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {job.raw_artifacts.map((artifact, i) => (
                <li key={i} className="truncate">
                  <code>{artifact}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Logs */}
        <div>
          <h4 className="mb-2 text-sm font-medium">Logs:</h4>
          <ScrollArea className="h-64 rounded-md border bg-muted/30 p-3">
            {logsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : logs && logs.length > 0 ? (
              <div className="space-y-2 font-mono text-xs">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-2">
                    <span className="text-muted-foreground whitespace-nowrap">
                      {new Date(log.ts).toLocaleTimeString('de-DE')}
                    </span>
                    <LogLevelIcon level={log.level} />
                    <span className={log.level === 'error' ? 'text-destructive' : ''}>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Keine Logs vorhanden.</p>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
