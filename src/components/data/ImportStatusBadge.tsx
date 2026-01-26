import { ImportJobStatus } from '@/types/dataModule';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface ImportStatusBadgeProps {
  status: ImportJobStatus | undefined | null;
}

export function ImportStatusBadge({ status }: ImportStatusBadgeProps) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Clock className="mr-1 h-3 w-3" />
        Kein Import
      </Badge>
    );
  }

  switch (status) {
    case 'pending':
      return (
        <Badge variant="secondary">
          <Clock className="mr-1 h-3 w-3" />
          Ausstehend
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
    default:
      return null;
  }
}
