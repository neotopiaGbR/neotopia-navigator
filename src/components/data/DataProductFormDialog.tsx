import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreateDataProduct, useUpdateDataProduct } from '@/hooks/useDataProducts';
import { useDataSources } from '@/hooks/useDataSources';
import type { DataProduct } from '@/types/dataModule';
import { toast } from '@/hooks/use-toast';

const formSchema = z.object({
  source_id: z.string().min(1, 'Datenquelle ist erforderlich'),
  name: z.string().min(1, 'Name ist erforderlich'),
  description: z.string().optional(),
  resolution: z.string().optional(),
  temporal_coverage: z.string().optional(),
  update_frequency: z.string().optional(),
  access_url: z.string().url('Ungültige URL').optional().or(z.literal('')),
});

type FormValues = z.infer<typeof formSchema>;

interface DataProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: DataProduct | null;
  defaultSourceId?: string;
}

export function DataProductFormDialog({
  open,
  onOpenChange,
  product,
  defaultSourceId,
}: DataProductFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createProduct = useCreateDataProduct();
  const updateProduct = useUpdateDataProduct();
  const { data: sources } = useDataSources();
  const isEditing = !!product;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      source_id: product?.source_id || defaultSourceId || '',
      name: product?.name || '',
      description: product?.description || '',
      resolution: product?.resolution || '',
      temporal_coverage: product?.temporal_coverage || '',
      update_frequency: product?.update_frequency || '',
      access_url: product?.access_url || '',
    },
  });

  async function onSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      if (isEditing && product) {
        await updateProduct.mutateAsync({
          id: product.id,
          ...values,
          access_url: values.access_url || null,
        });
        toast({ title: 'Datenprodukt aktualisiert' });
      } else {
        await createProduct.mutateAsync({
          source_id: values.source_id,
          name: values.name,
          description: values.description,
          resolution: values.resolution,
          temporal_coverage: values.temporal_coverage,
          update_frequency: values.update_frequency,
          access_url: values.access_url || undefined,
        });
        toast({ title: 'Datenprodukt erstellt' });
      }
      onOpenChange(false);
      form.reset();
    } catch (error) {
      toast({
        title: 'Fehler',
        description: 'Vorgang konnte nicht abgeschlossen werden.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Datenprodukt bearbeiten' : 'Neues Datenprodukt'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Bearbeiten Sie die Details des Datenprodukts.'
              : 'Fügen Sie ein neues Datenprodukt hinzu.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="source_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Datenquelle</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Datenquelle auswählen" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sources?.map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {source.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="z.B. ERA5-Land Hourly Temperature" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Beschreibung (optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Kurze Beschreibung des Produkts" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="resolution"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Auflösung</FormLabel>
                    <FormControl>
                      <Input placeholder="z.B. 1 km" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="update_frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Aktualisierung</FormLabel>
                    <FormControl>
                      <Input placeholder="z.B. Monatlich" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="temporal_coverage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Zeitliche Abdeckung</FormLabel>
                  <FormControl>
                    <Input placeholder="z.B. 1991-2024" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="access_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Zugangs-URL (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Speichern...' : isEditing ? 'Aktualisieren' : 'Erstellen'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
