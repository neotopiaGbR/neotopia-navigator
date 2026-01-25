import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, RefreshCw, Shield, Users } from 'lucide-react';
import neotopiaLogo from '@/assets/neotopia-logo.svg';

interface UserProfile {
  id: string;
  role: 'admin' | 'kommune' | null;
  email?: string | null;
  created_at?: string;
}

const Admin = () => {
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': SUPABASE_PUBLISHABLE_KEY,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Fehler beim Laden der Benutzer');
      }

      setUsers(data.users || []);
    } catch (error: any) {
      toast({
        title: 'Fehler',
        description: error.message || 'Benutzer konnten nicht geladen werden',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.access_token) {
      fetchUsers();
    }
  }, [session?.access_token]);

  const updateUserRole = async (userId: string, newRole: 'admin' | 'kommune') => {
    if (userId === user?.id) {
      toast({
        title: 'Nicht erlaubt',
        description: 'Sie können Ihre eigene Rolle nicht ändern',
        variant: 'destructive',
      });
      return;
    }

    setUpdating(userId);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) throw error;

      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      toast({
        title: 'Erfolg',
        description: 'Benutzerrolle wurde aktualisiert',
      });
    } catch (error: any) {
      toast({
        title: 'Fehler',
        description: error.message || 'Rolle konnte nicht aktualisiert werden',
        variant: 'destructive',
      });
    } finally {
      setUpdating(null);
    }
  };

  const getRoleBadgeVariant = (role: string | null) => {
    switch (role) {
      case 'admin':
        return 'default';
      case 'kommune':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/dashboard')}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <img src={neotopiaLogo} alt="Neotopia" className="h-7 w-auto" />
                <span className="text-2xl font-bold text-foreground">navigator</span>
                <Badge variant="default" className="bg-accent text-accent-foreground">
                  <Shield className="mr-1 h-3 w-3" />
                  Admin
                </Badge>
              </div>
              <p className="mt-1 text-muted-foreground">Benutzerverwaltung</p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={fetchUsers}
            disabled={loading}
            className="border-accent text-accent hover:bg-accent hover:text-accent-foreground"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </Button>
        </header>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Users className="h-5 w-5" />
              Benutzer ({users.length})
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Verwalten Sie Benutzerrollen und Berechtigungen
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-accent" />
              </div>
            ) : users.length === 0 ? (
              <div className="rounded-lg border border-dashed border-accent/50 p-12 text-center">
                <p className="text-lg text-muted-foreground">
                  Keine Benutzer gefunden
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>E-Mail</TableHead>
                      <TableHead>Benutzer-ID</TableHead>
                      <TableHead>Aktuelle Rolle</TableHead>
                      <TableHead>Erstellt am</TableHead>
                      <TableHead className="text-right">Rolle ändern</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((profile) => (
                      <TableRow key={profile.id}>
                        <TableCell>
                          {profile.email || (
                            <span className="text-muted-foreground italic">Keine E-Mail</span>
                          )}
                          {profile.id === user?.id && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              Sie
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {profile.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(profile.role)}>
                            {profile.role || 'Keine Rolle'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {profile.created_at
                            ? new Date(profile.created_at).toLocaleDateString('de-DE')
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Select
                            value={profile.role || ''}
                            onValueChange={(value) =>
                              updateUserRole(profile.id, value as 'admin' | 'kommune')
                            }
                            disabled={updating === profile.id || profile.id === user?.id}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue placeholder="Rolle wählen" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="kommune">Kommune</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Admin;
