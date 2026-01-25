import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type UserRole = 'admin' | 'kommune' | 'user' | null;

interface Profile {
  id: string;
  role: UserRole;
}

type ProfileStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  profileStatus: ProfileStatus;
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

const PROFILE_FETCH_TIMEOUT_MS = 5000;

const devLog = (tag: string, ...args: unknown[]) => {
  if (import.meta.env.DEV) {
    console.log(`[Neotopia:${tag}]`, new Date().toISOString().slice(11, 23), ...args);
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle');
  
  const mountedRef = useRef(true);
  const profileFetchAbortRef = useRef<AbortController | null>(null);

  // Non-blocking profile fetch with timeout - NEVER throws, NEVER blocks UI
  const fetchProfileAsync = useCallback(async (userId: string) => {
    // Abort any existing profile fetch
    if (profileFetchAbortRef.current) {
      profileFetchAbortRef.current.abort();
    }
    profileFetchAbortRef.current = new AbortController();
    
    devLog('PROFILE_FETCH_START', { userId });
    setProfileLoading(true);
    setProfileStatus('loading');
    
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('PROFILE_FETCH_TIMEOUT')), PROFILE_FETCH_TIMEOUT_MS);
    });

    try {
      const fetchPromise = supabase
        .from('profiles')
        .select('id, role')
        .eq('id', userId)
        .maybeSingle();

      // Race between fetch and timeout
      const { data, error, status } = await Promise.race([
        fetchPromise,
        timeoutPromise,
      ]) as Awaited<typeof fetchPromise>;

      if (!mountedRef.current) return;

      if (error) {
        devLog('PROFILE_FETCH_ERROR', {
          status,
          code: error.code,
          message: error.message,
          hint: error.hint,
        });
        // Fallback to 'user' role - DO NOT block, DO NOT logout
        setProfile({ id: userId, role: 'user' });
        setProfileStatus('error');
        return;
      }

      if (!data) {
        devLog('PROFILE_FETCH_OK', { result: 'no_row_found', fallback: 'user' });
        setProfile({ id: userId, role: 'user' });
        setProfileStatus('loaded');
        return;
      }

      devLog('PROFILE_FETCH_OK', { role: data.role });
      setProfile({ id: data.id, role: (data.role as UserRole) || 'user' });
      setProfileStatus('loaded');
    } catch (err) {
      if (!mountedRef.current) return;
      
      const isTimeout = err instanceof Error && err.message === 'PROFILE_FETCH_TIMEOUT';
      devLog('PROFILE_FETCH_ERROR', {
        type: isTimeout ? 'timeout' : 'network_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      // Fallback to 'user' role - app must continue
      setProfile({ id: userId, role: 'user' });
      setProfileStatus('error');
    } finally {
      if (mountedRef.current) {
        setProfileLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let initialSessionChecked = false;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mountedRef.current) return;
      
      devLog('SESSION_CHANGED', { 
        event: _event, 
        hasSession: !!newSession,
        userId: newSession?.user?.id,
        initialChecked: initialSessionChecked,
      });
      
      // Update session state IMMEDIATELY - never block on profile
      setSession(newSession);
      setUser(newSession?.user ?? null);
      
      // Only set loading false after initial session check
      if (!initialSessionChecked) {
        initialSessionChecked = true;
        setLoading(false);
      }

      // Profile fetch is ASYNC and NON-BLOCKING - uses setTimeout to not block auth
      if (newSession?.user) {
        // Deferred to not block the auth state change callback
        setTimeout(() => {
          if (mountedRef.current) {
            fetchProfileAsync(newSession.user.id);
          }
        }, 0);
      } else {
        setProfile(null);
        setProfileStatus('idle');
      }
    });

    // THEN check for existing session with try/catch
    const checkExistingSession = async () => {
      try {
        devLog('SESSION_CHECK_START', {});
        const { data: { session: existingSession }, error } = await supabase.auth.getSession();
        
        if (!mountedRef.current) return;

        if (error) {
          devLog('SESSION_CHECK_ERROR', { message: error.message });
          setLoading(false);
          return;
        }
        
        devLog('SESSION_CHECK_OK', { 
          hasSession: !!existingSession,
          userId: existingSession?.user?.id,
        });
        
        setSession(existingSession);
        setUser(existingSession?.user ?? null);
        
        if (existingSession?.user) {
          fetchProfileAsync(existingSession.user.id);
        }
      } catch (err) {
        devLog('SESSION_CHECK_ERROR', { 
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        if (mountedRef.current && !initialSessionChecked) {
          initialSessionChecked = true;
          setLoading(false);
        }
      }
    };

    checkExistingSession();

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      if (profileFetchAbortRef.current) {
        profileFetchAbortRef.current.abort();
      }
    };
  }, [fetchProfileAsync]);

  const signUp = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });
      return { error: error as Error | null };
    } catch (err) {
      devLog('SIGNUP_ERROR', { message: err instanceof Error ? err.message : 'Unknown' });
      return { error: err as Error };
    }
  };

  const signIn = async (email: string, password: string) => {
    devLog('LOGIN_START', { email });
    
    try {
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
    } catch (err) {
      devLog('LOGIN_ERROR', { message: err instanceof Error ? err.message : 'Unknown' });
      return { error: err as Error, session: null };
    }
  };

  const signOut = async () => {
    try {
      setProfile(null);
      setProfileStatus('idle');
      await supabase.auth.signOut();
    } catch (err) {
      devLog('SIGNOUT_ERROR', { message: err instanceof Error ? err.message : 'Unknown' });
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return { error: error as Error | null };
    } catch (err) {
      devLog('RESET_PASSWORD_ERROR', { message: err instanceof Error ? err.message : 'Unknown' });
      return { error: err as Error };
    }
  };

  const updatePassword = async (newPassword: string) => {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      return { error: error as Error | null };
    } catch (err) {
      devLog('UPDATE_PASSWORD_ERROR', { message: err instanceof Error ? err.message : 'Unknown' });
      return { error: err as Error };
    }
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
      profileStatus,
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
