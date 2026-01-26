import { useState, useEffect } from 'react';
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
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreateDataSource, useUpdateDataSource } from '@/hooks/useDataSources';
import type { DataSource } from '@/types/dataModule';
import { toast } from '@/hooks/use-toast';

const formSchema = z.object({
  key: z.string().min(1, 'Key ist erforderlich'),
  name: z.string().min(1, 'Name ist erforderlich'),
  description: z.string().optional(),
  homepage: z.string().url('Ungültige URL').optional().or(z.literal('')),
  license_name: z.string().min(1, 'Lizenzname ist erforderlich'),
  license_url: z.string().url('Ungültige URL').optional().or(z.literal('')),
  attribution_text: z.string().min(1, 'Quellenangabe ist erforderlich'),
});

type FormValues = z.infer<typeof formSchema>;

interface DataSourceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: DataSource | null;
}

export function DataSourceFormDialog({ open, onOpenChange, source }: DataSourceFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createSource = useCreateDataSource();
  const updateSource = useUpdateDataSource();
  const isEditing = !!source;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      key: source?.key || '',
      name: source?.name || '',
      description: source?.description || '',
      homepage: source?.homepage || '',
      license_name: source?.license_name || '',
      license_url: source?.license_url || '',
      attribution_text: source?.attribution_text || '',
    },
  });

  useEffect(() => {
    if (source) {
      form.reset({
        key: source.key || '',
        name: source.name || '',
        description: source.description || '',
        homepage: source.homepage || '',
        license_name: source.license_name || '',
        license_url: source.license_url || '',
        attribution_text: source.attribution_text || '',
      });
    } else {
      form.reset({
        key: '',
        name: '',
        description: '',
        homepage: '',
        license_name: '',
        license_url: '',
        attribution_text: '',
      });
    }
  }, [source, form]);

  async function onSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      if (isEditing && source) {
        await updateSource.mutateAsync({
          id: source.id,
          key: values.key,
          name: values.name,
          description: values.description || null,
          homepage: values.homepage || null,
          license_name: values.license_name,
          license_url: values.license_url || null,
          attribution_text: values.attribution_text,
        });
        toast({ title: 'Datenquelle aktualisiert' });
      } else {
        await createSource.mutateAsync({
          key: values.key,
          name: values.name,
          description: values.description,
          homepage: values.homepage,
          license_name: values.license_name,
          license_url: values.license_url,
          attribution_text: values.attribution_text,
        });
        toast({ title: 'Datenquelle erstellt' });
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
            {isEditing ? 'Datenquelle bearbeiten' : 'Neue Datenquelle'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Bearbeiten Sie die Details der Datenquelle.'
              : 'Fügen Sie eine neue Open-Data-Quelle hinzu.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Key</FormLabel>
                    <FormControl>
                      <Input placeholder="z.B. copernicus_cds" {...field} disabled={isEditing} />
                    </FormControl>
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
                      <Input placeholder="z.B. Copernicus CDS" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Beschreibung (optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Kurze Beschreibung der Datenquelle" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="homepage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Homepage (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="license_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lizenz</FormLabel>
                    <FormControl>
                      <Input placeholder="z.B. CC BY 4.0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="license_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lizenz-URL (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="attribution_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quellenangabe</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="z.B. © Copernicus Climate Change Service 2024"
                      {...field}
                    />
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
