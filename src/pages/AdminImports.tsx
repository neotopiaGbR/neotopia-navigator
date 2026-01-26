import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ImportOverviewCards } from '@/components/admin/ImportOverviewCards';
import { ImportProductsTable } from '@/components/admin/ImportProductsTable';
import { ImportJobLogs } from '@/components/admin/ImportJobLogs';
import { useImportOverview, useEnqueueAllImports } from '@/hooks/useImportSystem';
import { ArrowLeft, Play, Clock, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export default function AdminImportsPage() {
  const { data: overview, isLoading } = useImportOverview('EU_full');
  const enqueueAll = useEnqueueAllImports();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const handleQueueAll = async () => {
    try {
      const jobIds = await enqueueAll.mutateAsync();
      toast({ title: `${jobIds.length} Jobs eingereiht` });
    } catch (error) {
      toast({
        title: 'Fehler',
        description: 'Jobs konnten nicht eingereiht werden.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <Link to="/admin">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">EU Import Console</h1>
              <p className="text-sm text-muted-foreground">
                Datenprodukte importieren und überwachen
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/admin/attribution">
              <Button variant="outline">Quellenangaben</Button>
            </Link>
            <Button
              variant="outline"
              onClick={handleQueueAll}
              disabled={enqueueAll.isPending}
            >
              {enqueueAll.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Clock className="mr-2 h-4 w-4" />
              )}
              Alle einreihen (EU)
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-8">
        <ImportOverviewCards overview={overview} isLoading={isLoading} />

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Datenprodukte</CardTitle>
            </CardHeader>
            <CardContent>
              <ImportProductsTable onViewLogs={setSelectedJobId} />
            </CardContent>
          </Card>

          <div className="lg:col-span-1">
            {selectedJobId ? (
              <ImportJobLogs jobId={selectedJobId} />
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">
                    Wählen Sie einen Job, um Logs anzuzeigen.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
