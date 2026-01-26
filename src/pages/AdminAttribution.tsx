import { Link } from 'react-router-dom';
import { useAttribution } from '@/hooks/useAttribution';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react';

export default function AdminAttributionPage() {
  const { data: attributions, isLoading } = useAttribution();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card print:hidden">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <Link to="/admin/imports">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Quellenangaben</h1>
              <p className="text-sm text-muted-foreground">
                Daten & Lizenzen für PDF-Export
              </p>
            </div>
          </div>
          <Button onClick={() => window.print()}>PDF drucken</Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card className="print:border-0 print:shadow-none">
          <CardHeader className="print:pb-2">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Daten & Lizenzen
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-6">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : attributions && attributions.length > 0 ? (
              <div className="space-y-8">
                {attributions.map((entry) => (
                  <div key={entry.source_key} className="border-b pb-6 last:border-0">
                    <h3 className="text-lg font-semibold">{entry.source_name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {entry.attribution_text}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm">
                      <span className="text-muted-foreground">
                        Lizenz:{' '}
                        {entry.license_url ? (
                          <a
                            href={entry.license_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {entry.license_name}
                            <ExternalLink className="ml-1 inline h-3 w-3" />
                          </a>
                        ) : (
                          entry.license_name
                        )}
                      </span>
                    </div>
                    {entry.products.length > 0 && (
                      <ul className="mt-3 list-inside list-disc text-sm">
                        {entry.products.map((p) => (
                          <li key={p.key}>
                            {p.name}
                            {p.spatial_resolution && ` — ${p.spatial_resolution}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-muted-foreground">
                Keine Datenquellen registriert.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
