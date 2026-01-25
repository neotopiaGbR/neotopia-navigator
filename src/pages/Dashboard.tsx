import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-accent">NEOTOPIA</h1>
            <p className="text-muted-foreground">Navigator Dashboard</p>
          </div>
          <Button
            variant="outline"
            onClick={handleSignOut}
            className="border-accent text-accent hover:bg-accent hover:text-accent-foreground"
          >
            Abmelden
          </Button>
        </header>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">Willkommen!</CardTitle>
            <CardDescription className="text-muted-foreground">
              Sie sind angemeldet als: {user?.email}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed border-accent/50 p-12 text-center">
              <p className="text-lg text-muted-foreground">
                Dashboard-Inhalt wird hier angezeigt
              </p>
              <p className="mt-2 text-sm text-muted-foreground/70">
                Platzhalter für zukünftige Funktionen
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
