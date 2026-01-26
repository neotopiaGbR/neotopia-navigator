import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDataProducts, useDeleteDataProduct } from '@/hooks/useDataProducts';
import { useUpdateImportJobStatus } from '@/hooks/useImportJobs';
import {
  DataProductFormDialog,
  ImportStatusBadge,
  CreateImportJobDialog,
} from '@/components/data';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  Plus,
  ExternalLink,
  Edit,
  Trash2,
  Package,
  ArrowLeft,
  MoreHorizontal,
  Play,
  CheckCircle2,
  XCircle,
  Upload,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { DataProduct, ImportJobStatus } from '@/types/dataModule';

export default function DataProductsPage() {
  const { data: products, isLoading, error } = useDataProducts();
  const deleteProduct = useDeleteDataProduct();
  const updateJobStatus = useUpdateImportJobStatus();

  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<DataProduct | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DataProduct | null>(null);
  const [importJobDialog, setImportJobDialog] = useState<DataProduct | null>(null);

  const handleEdit = (product: DataProduct) => {
    setEditingProduct(product);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteProduct.mutateAsync(deleteConfirm.id);
      toast({ title: 'Datenprodukt gelöscht' });
    } catch {
      toast({
        title: 'Fehler',
        description: 'Datenprodukt konnte nicht gelöscht werden.',
        variant: 'destructive',
      });
    }
    setDeleteConfirm(null);
  };

  const handleStatusUpdate = async (
    product: DataProduct,
    status: ImportJobStatus
  ) => {
    if (!product.latest_import) {
      toast({
        title: 'Kein Import-Job',
        description: 'Erstellen Sie zuerst einen Import-Job.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await updateJobStatus.mutateAsync({
        id: product.latest_import.id,
        status,
      });
      toast({ title: `Status auf "${status}" gesetzt` });
    } catch {
      toast({
        title: 'Fehler',
        description: 'Status konnte nicht aktualisiert werden.',
        variant: 'destructive',
      });
    }
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
              <h1 className="text-2xl font-bold">Datenprodukte</h1>
              <p className="text-sm text-muted-foreground">
                Datenprodukte und Import-Jobs verwalten
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/data-sources">
              <Button variant="outline">Datenquellen</Button>
            </Link>
            <Link to="/attribution">
              <Button variant="outline">Quellenangaben</Button>
            </Link>
            <Button
              onClick={() => {
                setEditingProduct(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Neues Produkt
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Alle Datenprodukte</CardTitle>
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
                Fehler beim Laden der Datenprodukte.
              </p>
            ) : products && products.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Quelle</TableHead>
                    <TableHead>Auflösung</TableHead>
                    <TableHead>Zeitraum</TableHead>
                    <TableHead>Aktualisierung</TableHead>
                    <TableHead>Import-Status</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="font-medium">{product.name}</div>
                        {product.access_url && (
                          <a
                            href={product.access_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            Zugang
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </TableCell>
                      <TableCell>{product.source?.name || '–'}</TableCell>
                      <TableCell>{product.spatial_resolution || '–'}</TableCell>
                      <TableCell>{product.temporal_coverage || '–'}</TableCell>
                      <TableCell>{product.update_frequency || '–'}</TableCell>
                      <TableCell>
                        <ImportStatusBadge status={product.latest_import?.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setImportJobDialog(product)}
                          >
                            <Upload className="mr-1 h-3 w-3" />
                            Import
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEdit(product)}>
                                <Edit className="mr-2 h-4 w-4" />
                                Bearbeiten
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleStatusUpdate(product, 'running')}
                                disabled={!product.latest_import}
                              >
                                <Play className="mr-2 h-4 w-4" />
                                Status: Läuft
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleStatusUpdate(product, 'loaded')}
                                disabled={!product.latest_import}
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Status: Geladen
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleStatusUpdate(product, 'failed')}
                                disabled={!product.latest_import}
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                Status: Fehlgeschlagen
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleteConfirm(product)}
                                className="text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Löschen
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-12 text-center">
                <Package className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium">Keine Datenprodukte</h3>
                <p className="mt-2 text-muted-foreground">
                  Fügen Sie Ihr erstes Datenprodukt hinzu.
                </p>
                <Button
                  className="mt-4"
                  onClick={() => {
                    setEditingProduct(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Erstes Produkt hinzufügen
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <DataProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editingProduct}
      />

      {importJobDialog && (
        <CreateImportJobDialog
          open={!!importJobDialog}
          onOpenChange={() => setImportJobDialog(null)}
          productId={importJobDialog.id}
          productName={importJobDialog.name}
        />
      )}

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Datenprodukt löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie "{deleteConfirm?.name}" wirklich löschen? Alle zugehörigen
              Import-Jobs werden ebenfalls gelöscht.
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
