import { Link } from 'react-router-dom';
import { useDataSources } from '@/hooks/useDataSources';
import { useDataProducts } from '@/hooks/useDataProducts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react';
import type { DataSource, DataProduct } from '@/types/dataModule';

interface GroupedData {
  source: DataSource;
  products: DataProduct[];
}

export default function AttributionPage() {
  const { data: sources, isLoading: sourcesLoading } = useDataSources();
  const { data: products, isLoading: productsLoading } = useDataProducts();

  const isLoading = sourcesLoading || productsLoading;

  // Group products by source
  const groupedData: GroupedData[] = (sources || []).map((source) => ({
    source,
    products: (products || []).filter((p) => p.source_id === source.id),
  }));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card print:hidden">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
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
          <div className="flex gap-2">
            <Link to="/data-sources">
              <Button variant="outline">Datenquellen</Button>
            </Link>
            <Link to="/data-products">
              <Button variant="outline">Datenprodukte</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Print-optimized attribution content */}
        <div id="attribution-content" className="space-y-6">
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
              ) : groupedData.length > 0 ? (
                <div className="space-y-8">
                  {groupedData.map(({ source, products }) => (
                    <div key={source.id} className="border-b pb-6 last:border-0">
                      <div className="mb-3">
                        <h3 className="text-lg font-semibold">{source.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {source.attribution_text}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3 text-sm">
                          <span className="text-muted-foreground">
                            Lizenz:{' '}
                            {source.license_url ? (
                              <a
                                href={source.license_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline print:text-foreground"
                              >
                                {source.license_name}
                                <ExternalLink className="h-3 w-3 print:hidden" />
                              </a>
                            ) : (
                              <span>{source.license_name}</span>
                            )}
                          </span>
                          {source.homepage && (
                            <a
                              href={source.homepage}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline print:text-foreground"
                            >
                              Website
                              <ExternalLink className="h-3 w-3 print:hidden" />
                            </a>
                          )}
                        </div>
                      </div>
                      {products.length > 0 && (
                        <div className="mt-4">
                          <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                            Verwendete Produkte:
                          </h4>
                          <ul className="list-inside list-disc space-y-1 text-sm">
                            {products.map((product) => (
                              <li key={product.id}>
                                <span className="font-medium">{product.name}</span>
                                {product.spatial_resolution && (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    — {product.spatial_resolution}
                                  </span>
                                )}
                                {product.temporal_coverage && (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    ({product.temporal_coverage})
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-medium">Keine Datenquellen</h3>
                  <p className="mt-2 text-muted-foreground">
                    Fügen Sie Datenquellen hinzu, um Quellenangaben zu generieren.
                  </p>
                  <Link to="/data-sources">
                    <Button className="mt-4">Datenquellen verwalten</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Print footer */}
          <div className="hidden print:block text-center text-xs text-muted-foreground">
            <p>Generiert von Neotopia • {new Date().toLocaleDateString('de-DE')}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
