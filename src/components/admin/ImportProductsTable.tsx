import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
  Play, 
  Clock, 
  FileText, 
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { useDataProducts } from '@/hooks/useDataProducts';
import { useEnqueueImportJob, useRunImportJob } from '@/hooks/useImportSystem';
import { toast } from '@/hooks/use-toast';
import type { ImportJobStatus, DataProduct } from '@/types/dataModule';
import { Link } from 'react-router-dom';

function StatusBadge({ status }: { status: ImportJobStatus | undefined | null }) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Clock className="mr-1 h-3 w-3" />
        Nicht importiert
      </Badge>
    );
  }

  switch (status) {
    case 'pending':
    case 'queued':
      return (
        <Badge variant="secondary">
          <Clock className="mr-1 h-3 w-3" />
          {status === 'queued' ? 'In Warteschlange' : 'Ausstehend'}
        </Badge>
      );
    case 'running':
      return (
        <Badge className="bg-blue-500 hover:bg-blue-600">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Läuft
        </Badge>
      );
    case 'loaded':
      return (
        <Badge className="bg-green-600 hover:bg-green-700">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Geladen
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Fehlgeschlagen
        </Badge>
      );
    case 'partial':
      return (
        <Badge className="bg-yellow-500 hover:bg-yellow-600">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Teilweise
        </Badge>
      );
    default:
      return null;
  }
}

interface ImportProductsTableProps {
  onViewLogs: (jobId: string) => void;
}

export function ImportProductsTable({ onViewLogs }: ImportProductsTableProps) {
  const { data: products, isLoading } = useDataProducts();
  const enqueueJob = useEnqueueImportJob();
  const runJob = useRunImportJob();
  const [loadingProducts, setLoadingProducts] = useState<Set<string>>(new Set());

  const handleQueue = async (product: DataProduct) => {
    setLoadingProducts(prev => new Set(prev).add(product.id));
    try {
      await enqueueJob.mutateAsync({ product_key: product.key });
      toast({ title: `Job für "${product.name}" eingereiht` });
    } catch (error) {
      toast({
        title: 'Fehler',
        description: 'Job konnte nicht eingereiht werden.',
        variant: 'destructive',
      });
    } finally {
      setLoadingProducts(prev => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  };

  const handleRun = async (product: DataProduct) => {
    if (!product.latest_import?.id) {
      toast({
        title: 'Kein Job',
        description: 'Bitte zuerst einen Job einreihen.',
        variant: 'destructive',
      });
      return;
    }
    setLoadingProducts(prev => new Set(prev).add(product.id));
    try {
      await runJob.mutateAsync(product.latest_import.id);
      toast({ title: `Import für "${product.name}" gestartet` });
    } catch (error) {
      toast({
        title: 'Import-Fehler',
        description: 'Der Import konnte nicht gestartet werden. Prüfen Sie die Edge Function.',
        variant: 'destructive',
      });
    } finally {
      setLoadingProducts(prev => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produkt</TableHead>
            <TableHead>Quelle</TableHead>
            <TableHead>Auflösung</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Letzter Lauf</TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products && products.length > 0 ? (
            products.map((product) => {
              const isLoading = loadingProducts.has(product.id);
              const latestJob = product.latest_import;
              const canQueue = !latestJob || ['loaded', 'failed', 'partial'].includes(latestJob.status);
              const canRun = latestJob && ['queued', 'pending'].includes(latestJob.status);
              const hasLogs = !!latestJob?.id;

              return (
                <TableRow key={product.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{product.name}</div>
                      <code className="text-xs text-muted-foreground">{product.key}</code>
                    </div>
                  </TableCell>
                  <TableCell>
                    {product.source?.name || '–'}
                  </TableCell>
                  <TableCell>{product.spatial_resolution || '–'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{product.format || '–'}</Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={latestJob?.status} />
                  </TableCell>
                  <TableCell>
                    {latestJob?.finished_at ? (
                      <span className="text-sm text-muted-foreground">
                        {new Date(latestJob.finished_at).toLocaleString('de-DE')}
                      </span>
                    ) : latestJob?.started_at ? (
                      <span className="text-sm text-muted-foreground">
                        Gestartet: {new Date(latestJob.started_at).toLocaleString('de-DE')}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">–</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleQueue(product)}
                            disabled={isLoading || !canQueue}
                          >
                            {isLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Clock className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>EU Import einreihen</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRun(product)}
                            disabled={isLoading || !canRun}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Jetzt ausführen</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => hasLogs && onViewLogs(latestJob!.id)}
                            disabled={!hasLogs}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Logs anzeigen</TooltipContent>
                      </Tooltip>

                      {product.access_url && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                            >
                              <a href={product.access_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Datenquelle öffnen</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center">
                <p className="text-muted-foreground">
                  Keine Datenprodukte registriert.
                </p>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
