import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type UserRole = 'admin' | 'kommune' | 'unknown' | null;

interface Profile {
  id: string;
  role: UserRole;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  role: UserRole;
  isAdmin: boolean;
  isKommune: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null; session: Session | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const devLog = (tag: string, ...args: unknown[]) => {
  if (import.meta.env.DEV) {
    console.log(`[Neotopia:${tag}]`, ...args);
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // Non-blocking profile fetch - NEVER throws, NEVER blocks
  const fetchProfileAsync = useCallback(async (userId: string) => {
    devLog('PROFILE_FETCH_START', { userId });
    setProfileLoading(true);
    
    try {
      const { data, error, status } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        devLog('PROFILE_FETCH_ERROR', {
          status,
          code: error.code,
          message: error.message,
          details: error.details,
        });
        // Set unknown role but don't block - user can still use app
        setProfile({ id: userId, role: 'unknown' });
        return;
      }

      if (!data) {
        devLog('PROFILE_FETCH_OK', { result: 'no_row_found' });
        setProfile({ id: userId, role: 'unknown' });
        return;
      }

      devLog('PROFILE_FETCH_OK', { role: data.role });
      setProfile({ id: data.id, role: data.role as UserRole });
    } catch (err) {
      devLog('PROFILE_FETCH_ERROR', {
        status: 'network_error',
        code: 'UNEXPECTED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      setProfile({ id: userId, role: 'unknown' });
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      
      devLog('SESSION_CHANGED', { 
        event: _event, 
        hasSession: !!newSession,
        userId: newSession?.user?.id 
      });
      
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);

      // Profile fetch is ASYNC and NON-BLOCKING
      if (newSession?.user) {
        // Use setTimeout to ensure this doesn't block the current execution
        setTimeout(() => {
          if (mounted) {
            fetchProfileAsync(newSession.user.id);
          }
        }, 0);
      } else {
        setProfile(null);
      }
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      if (!mounted) return;
      
      devLog('SESSION_CHANGED', { 
        event: 'INITIAL_SESSION', 
        hasSession: !!existingSession,
        userId: existingSession?.user?.id 
      });
      
      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      setLoading(false);

      if (existingSession?.user) {
        fetchProfileAsync(existingSession.user.id);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfileAsync]);

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    devLog('LOGIN_START', { email });
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      devLog('LOGIN_ERROR', { code: error.code, message: error.message });
      return { error: error as Error | null, session: null };
    }
    
    devLog('LOGIN_OK', { userId: data.user?.id, hasSession: !!data.session });
    return { error: null, session: data.session };
  };

  const signOut = async () => {
    setProfile(null);
    await supabase.auth.signOut();
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error as Error | null };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    return { error: error as Error | null };
  };

  const role = profile?.role ?? null;
  const isAdmin = role === 'admin';
  const isKommune = role === 'kommune';

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      profileLoading,
      role,
      isAdmin,
      isKommune,
      signUp,
      signIn,
      signOut,
      resetPassword,
      updatePassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
