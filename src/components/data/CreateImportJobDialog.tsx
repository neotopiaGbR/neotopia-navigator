import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useCreateImportJob } from '@/hooks/useImportJobs';
import type { ImportScope } from '@/types/dataModule';
import { toast } from '@/hooks/use-toast';

interface CreateImportJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
}

export function CreateImportJobDialog({
  open,
  onOpenChange,
  productId,
  productName,
}: CreateImportJobDialogProps) {
  const [scope, setScope] = useState<ImportScope>('Berlin_BBOX');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createJob = useCreateImportJob();

  async function handleSubmit() {
    setIsSubmitting(true);
    try {
      await createJob.mutateAsync({
        product_id: productId,
        scope,
      });
      toast({ title: 'Import-Job erstellt' });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Fehler',
        description: 'Import-Job konnte nicht erstellt werden.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Import-Job erstellen</DialogTitle>
          <DialogDescription>
            Erstellen Sie einen Import-Job für "{productName}".
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Räumlicher Umfang</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as ImportScope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Berlin_BBOX">Berlin Bounding Box</SelectItem>
                <SelectItem value="EU_full">EU komplett</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Erstellen...' : 'Job erstellen'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
