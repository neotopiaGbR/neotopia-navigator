import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDataSources, useDeleteDataSource } from '@/hooks/useDataSources';
import { useDataProductsBySource } from '@/hooks/useDataProducts';
import { DataSourceFormDialog } from '@/components/data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, ExternalLink, Edit, Trash2, Database, ArrowLeft } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { DataSource } from '@/types/dataModule';
import { ImportStatusBadge } from '@/components/data';

function SourceProductsDialog({
  source,
  open,
  onOpenChange,
}: {
  source: DataSource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: products, isLoading } = useDataProductsBySource(source?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Produkte von {source?.name}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : products && products.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Auflösung</TableHead>
                <TableHead>Zeitraum</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>{product.spatial_resolution || '–'}</TableCell>
                  <TableCell>{product.temporal_coverage || '–'}</TableCell>
                  <TableCell>
                    <ImportStatusBadge status={product.latest_import?.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-8 text-center text-muted-foreground">
            Keine Produkte für diese Quelle vorhanden.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DataSourcesPage() {
  const { data: sources, isLoading, error } = useDataSources();
  const deleteSource = useDeleteDataSource();
  const [formOpen, setFormOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [productsDialogSource, setProductsDialogSource] = useState<DataSource | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DataSource | null>(null);

  const handleEdit = (source: DataSource) => {
    setEditingSource(source);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteSource.mutateAsync(deleteConfirm.id);
      toast({ title: 'Datenquelle gelöscht' });
    } catch {
      toast({
        title: 'Fehler',
        description: 'Datenquelle konnte nicht gelöscht werden.',
        variant: 'destructive',
      });
    }
    setDeleteConfirm(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Datenquellen</h1>
              <p className="text-sm text-muted-foreground">
                Open-Data-Quellen verwalten
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/data-products">
              <Button variant="outline">
                <Database className="mr-2 h-4 w-4" />
                Datenprodukte
              </Button>
            </Link>
            <Link to="/attribution">
              <Button variant="outline">Quellenangaben</Button>
            </Link>
            <Button onClick={() => { setEditingSource(null); setFormOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Neue Quelle
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Alle Datenquellen</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : error ? (
              <p className="py-8 text-center text-destructive">
                Fehler beim Laden der Datenquellen.
              </p>
            ) : sources && sources.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Lizenz</TableHead>
                    <TableHead>Quellenangabe</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((source) => (
                    <TableRow key={source.id}>
                      <TableCell>
                        <button
                          onClick={() => setProductsDialogSource(source)}
                          className="font-medium text-primary hover:underline"
                        >
                          {source.name}
                        </button>
                      </TableCell>
                      <TableCell>
                        {source.license_url ? (
                          <a
                            href={source.license_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {source.license_name}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          source.license_name
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {source.attribution_text}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(source)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteConfirm(source)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-12 text-center">
                <Database className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium">Keine Datenquellen</h3>
                <p className="mt-2 text-muted-foreground">
                  Fügen Sie Ihre erste Open-Data-Quelle hinzu.
                </p>
                <Button
                  className="mt-4"
                  onClick={() => { setEditingSource(null); setFormOpen(true); }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Erste Quelle hinzufügen
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <DataSourceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        source={editingSource}
      />

      <SourceProductsDialog
        source={productsDialogSource}
        open={!!productsDialogSource}
        onOpenChange={() => setProductsDialogSource(null)}
      />

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Datenquelle löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie "{deleteConfirm?.name}" wirklich löschen? Alle zugehörigen
              Produkte und Import-Jobs werden ebenfalls gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
