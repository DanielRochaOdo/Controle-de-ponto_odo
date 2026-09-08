import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';

import { supabase, isSupabaseConfigured } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const AuthContext = createContext(undefined);

const missingSupabaseError = () => new Error(
  'Supabase não configurado neste ambiente. Crie um arquivo .env.local com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'
);

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const clearAuthData = useCallback(() => {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith('sb-') && key.includes('auth-token')) {
        localStorage.removeItem(key);
      }
    });
    setSession(null);
    setUser(null);
    setProfile(null);
  }, []);

  const handleSession = useCallback(async (nextSession) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    if (!nextSession?.user) setProfile(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return undefined;
    }

    const getSession = async () => {
      try {
        const { data: { session: currentSession }, error } = await supabase.auth.getSession();

        if (error) {
          console.warn('Session error:', error.message);
          if (error.message.includes('refresh_token_not_found') ||
              error.message.includes('Invalid Refresh Token')) {
            clearAuthData();
          }
          handleSession(null);
        } else {
          handleSession(currentSession);
        }
      } catch (error) {
        console.warn('Failed to get session:', error);
        clearAuthData();
        handleSession(null);
      }
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, nextSession) => {
        if (event === 'TOKEN_REFRESHED' && !nextSession) clearAuthData();
        handleSession(nextSession);
      }
    );

    return () => subscription.unsubscribe();
  }, [handleSession, clearAuthData]);

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) {
      setProfile(null);
      return;
    }

    let cancelled = false;

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('display_name')
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        // A ausência da migration de perfil nunca deve impedir autenticação.
        console.warn('User profile unavailable:', error.message);
        setProfile(null);
        return;
      }

      setProfile(data || null);
    };

    loadProfile();
    return () => { cancelled = true; };
  }, [user?.id]);

  const signUp = useCallback(async (email, password, options) => {
    if (!isSupabaseConfigured) return { error: missingSupabaseError() };

    const { error } = await supabase.auth.signUp({ email, password, options });

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Falha ao criar usuário',
        description: error.message || 'Ocorreu um erro inesperado.',
      });
    }

    return { error };
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    if (!isSupabaseConfigured) return { error: missingSupabaseError() };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) {
      clearAuthData();
      return { error: null };
    }

    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.warn('Sign out error:', error);
    } catch (error) {
      console.warn('Failed to sign out:', error);
    } finally {
      clearAuthData();
    }

    return { error: null };
  }, [clearAuthData]);

  const displayName = profile?.display_name
    || user?.user_metadata?.name
    || user?.email?.split('@')[0]
    || 'Usuário';

  const value = useMemo(() => ({
    user,
    session,
    profile,
    displayName,
    loading,
    isSupabaseConfigured,
    signUp,
    signIn,
    signOut,
  }), [user, session, profile, displayName, loading, signUp, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
