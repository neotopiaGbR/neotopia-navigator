import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import neotopiaLogo from '@/assets/neotopia-logo.svg';

const Login = () => {
  const navigate = useNavigate();
  const { signIn, signUp, resetPassword } = useAuth();
  const { toast } = useToast();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResetForm, setShowResetForm] = useState(false);

  const getErrorMessage = (error: { message: string }): string => {
    const msg = error.message.toLowerCase();
    if (msg.includes('email not confirmed') || msg.includes('email_not_confirmed')) {
      return 'E-Mail noch nicht bestätigt. Bitte bestätige die Mail oder wir deaktivieren die Bestätigung im Supabase-Dashboard.';
    }
    if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
      return 'Ungültige Anmeldedaten. Bitte überprüfen Sie E-Mail und Passwort.';
    }
    return error.message;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { error } = await signIn(email, password);
      
      if (error) {
        const message = getErrorMessage(error);
        if (import.meta.env.DEV) {
          console.error('[Login] Sign in error:', error);
        }
        toast({
          variant: 'destructive',
          title: 'Anmeldung fehlgeschlagen',
          description: message,
        });
      } else {
        toast({
          title: 'Erfolgreich angemeldet',
          description: 'Willkommen zurück!',
        });
        navigate('/dashboard');
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Login] Unexpected error:', err);
      }
      toast({
        variant: 'destructive',
        title: 'Anmeldung fehlgeschlagen',
        description: 'Ein unerwarteter Fehler ist aufgetreten.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { error } = await signUp(email, password);
      
      if (error) {
        if (import.meta.env.DEV) {
          console.error('[Login] Sign up error:', error);
        }
        toast({
          variant: 'destructive',
          title: 'Registrierung fehlgeschlagen',
          description: error.message,
        });
      } else {
        toast({
          title: 'Registrierung erfolgreich',
          description: 'Bitte überprüfen Sie Ihre E-Mail zur Bestätigung.',
        });
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Login] Unexpected error:', err);
      }
      toast({
        variant: 'destructive',
        title: 'Registrierung fehlgeschlagen',
        description: 'Ein unerwarteter Fehler ist aufgetreten.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { error } = await resetPassword(email);
      
      if (error) {
        if (import.meta.env.DEV) {
          console.error('[Login] Reset password error:', error);
        }
        toast({
          variant: 'destructive',
          title: 'Fehler',
          description: error.message,
        });
      } else {
        toast({
          title: 'E-Mail gesendet',
          description: 'Überprüfen Sie Ihr Postfach für den Passwort-Reset-Link.',
        });
        setShowResetForm(false);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Login] Unexpected error:', err);
      }
      toast({
        variant: 'destructive',
        title: 'Fehler',
        description: 'Ein unerwarteter Fehler ist aufgetreten.',
      });
    } finally {
      setLoading(false);
    }
  };

  if (showResetForm) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex items-center justify-center gap-3">
              <img src={neotopiaLogo} alt="Neotopia" className="h-8 w-auto" />
              <span className="text-xl font-bold text-foreground">navigator</span>
            </div>
            <CardDescription className="text-muted-foreground">
              Geben Sie Ihre E-Mail-Adresse ein
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email" className="text-foreground">E-Mail</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="ihre@email.de"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="border-input bg-background text-foreground"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                disabled={loading}
              >
                {loading ? 'Wird gesendet...' : 'Link senden'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={() => setShowResetForm(false)}
              >
                Zurück zur Anmeldung
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex items-center justify-center gap-3">
            <img src={neotopiaLogo} alt="Neotopia" className="h-8 w-auto" />
            <span className="text-xl font-bold text-foreground">navigator</span>
          </div>
          <CardDescription className="text-muted-foreground">
            Melden Sie sich an oder erstellen Sie ein Konto
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-muted">
              <TabsTrigger value="login" className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
                Anmelden
              </TabsTrigger>
              <TabsTrigger value="register" className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
                Registrieren
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-foreground">E-Mail</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="ihre@email.de"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-input bg-background text-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-foreground">Passwort</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="border-input bg-background text-foreground"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                  disabled={loading}
                >
                  {loading ? 'Wird angemeldet...' : 'Anmelden'}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="w-full text-accent hover:text-accent/80"
                  onClick={() => setShowResetForm(true)}
                >
                  Passwort vergessen?
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="register">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="register-email" className="text-foreground">E-Mail</Label>
                  <Input
                    id="register-email"
                    type="email"
                    placeholder="ihre@email.de"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-input bg-background text-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password" className="text-foreground">Passwort</Label>
                  <Input
                    id="register-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="border-input bg-background text-foreground"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                  disabled={loading}
                >
                  {loading ? 'Wird registriert...' : 'Registrieren'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
