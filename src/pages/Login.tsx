import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import neotopiaLogo from '@/assets/neotopia-logo.svg';

const LOGIN_TIMEOUT_MS = 8000;

type AuthStep = 'idle' | 'submitting' | 'success' | 'error' | 'timeout';

const devLog = (tag: string, ...args: unknown[]) => {
  if (import.meta.env.DEV) {
    console.log(`[Login:${tag}]`, ...args);
  }
};

const Login = () => {
  const navigate = useNavigate();
  const { signIn, signUp, resetPassword, session } = useAuth();
  const { toast } = useToast();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResetForm, setShowResetForm] = useState(false);
  
  // DEV debug state
  const [authStep, setAuthStep] = useState<AuthStep>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // If already logged in, redirect immediately
  useEffect(() => {
    if (session) {
      devLog('SESSION_EXISTS', 'Redirecting to dashboard');
      navigate('/dashboard', { replace: true });
    }
  }, [session, navigate]);

  const clearTimeoutRef = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

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
    
    // Reset state
    setLoading(true);
    setAuthStep('submitting');
    setLastError(null);
    devLog('LOGIN_START', { email });

    // Set hard timeout
    timeoutRef.current = setTimeout(() => {
      devLog('LOGIN_TIMEOUT', { afterMs: LOGIN_TIMEOUT_MS });
      setAuthStep('timeout');
      setLastError('Login timeout. Please try again.');
      setLoading(false);
      toast({
        variant: 'destructive',
        title: 'Zeitüberschreitung',
        description: 'Login hat zu lange gedauert. Bitte erneut versuchen.',
      });
    }, LOGIN_TIMEOUT_MS);

    try {
      const { error, session: newSession } = await signIn(email, password);
      
      // Clear timeout immediately after response
      clearTimeoutRef();
      
      if (error) {
        const message = getErrorMessage(error);
        devLog('LOGIN_ERROR', { error });
        setAuthStep('error');
        setLastError(message);
        toast({
          variant: 'destructive',
          title: 'Anmeldung fehlgeschlagen',
          description: message,
        });
        return; // RETURN IMMEDIATELY
      }
      
      if (newSession) {
        devLog('LOGIN_OK', { userId: newSession.user?.id });
        setAuthStep('success');
        toast({
          title: 'Erfolgreich angemeldet',
          description: 'Willkommen zurück!',
        });
        // IMMEDIATELY navigate - DO NOT wait for profile
        navigate('/dashboard', { replace: true });
        return; // RETURN IMMEDIATELY
      }
      
      // Edge case: no error but no session
      devLog('LOGIN_ERROR', { reason: 'no_session_returned' });
      setAuthStep('error');
      setLastError('Keine Session erhalten');
      toast({
        variant: 'destructive',
        title: 'Anmeldung fehlgeschlagen',
        description: 'Keine Session erhalten. Bitte erneut versuchen.',
      });
    } catch (err) {
      clearTimeoutRef();
      const message = err instanceof Error ? err.message : 'Ein unerwarteter Fehler ist aufgetreten.';
      devLog('LOGIN_ERROR', { unexpected: err });
      setAuthStep('error');
      setLastError(message);
      toast({
        variant: 'destructive',
        title: 'Anmeldung fehlgeschlagen',
        description: message,
      });
    } finally {
      clearTimeoutRef();
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthStep('submitting');
    setLastError(null);
    
    try {
      const { error } = await signUp(email, password);
      
      if (error) {
        devLog('SIGNUP_ERROR', { error });
        setAuthStep('error');
        setLastError(error.message);
        toast({
          variant: 'destructive',
          title: 'Registrierung fehlgeschlagen',
          description: error.message,
        });
      } else {
        setAuthStep('success');
        toast({
          title: 'Registrierung erfolgreich',
          description: 'Bitte überprüfen Sie Ihre E-Mail zur Bestätigung.',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ein unerwarteter Fehler ist aufgetreten.';
      devLog('SIGNUP_ERROR', { unexpected: err });
      setAuthStep('error');
      setLastError(message);
      toast({
        variant: 'destructive',
        title: 'Registrierung fehlgeschlagen',
        description: message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthStep('submitting');
    setLastError(null);
    
    try {
      const { error } = await resetPassword(email);
      
      if (error) {
        devLog('RESET_ERROR', { error });
        setAuthStep('error');
        setLastError(error.message);
        toast({
          variant: 'destructive',
          title: 'Fehler',
          description: error.message,
        });
      } else {
        setAuthStep('success');
        toast({
          title: 'E-Mail gesendet',
          description: 'Überprüfen Sie Ihr Postfach für den Passwort-Reset-Link.',
        });
        setShowResetForm(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ein unerwarteter Fehler ist aufgetreten.';
      devLog('RESET_ERROR', { unexpected: err });
      setAuthStep('error');
      setLastError(message);
      toast({
        variant: 'destructive',
        title: 'Fehler',
        description: message,
      });
    } finally {
      setLoading(false);
    }
  };

  // DEV Debug Box Component
  const DevDebugBox = () => {
    if (!import.meta.env.DEV) return null;
    
    return (
      <div className="mt-4 rounded border border-yellow-500/50 bg-yellow-500/10 p-3 font-mono text-xs">
        <div className="mb-1 font-bold text-yellow-600">DEV DEBUG</div>
        <div><span className="text-muted-foreground">authStep:</span> <span className="text-foreground">{authStep}</span></div>
        <div><span className="text-muted-foreground">lastError:</span> <span className="text-red-400">{lastError || 'null'}</span></div>
        <div><span className="text-muted-foreground">hasSession:</span> <span className="text-foreground">{session ? 'true' : 'false'}</span></div>
        <div><span className="text-muted-foreground">loading:</span> <span className="text-foreground">{loading ? 'true' : 'false'}</span></div>
      </div>
    );
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
                  disabled={loading}
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
                disabled={loading}
              >
                Zurück zur Anmeldung
              </Button>
            </form>
            <DevDebugBox />
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
                    disabled={loading}
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
                    disabled={loading}
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
                  disabled={loading}
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
                    disabled={loading}
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
                    disabled={loading}
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
          <DevDebugBox />
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
