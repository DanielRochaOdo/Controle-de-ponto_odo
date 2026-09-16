import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';

import { supabase, isSupabaseConfigured } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { UserRole } from '@/types';

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
  const [profileLoading, setProfileLoading] = useState(false);

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
    setProfileLoading(false);
  }, []);

  const handleSession = useCallback(async (nextSession) => {
    const nextUser = nextSession?.user ?? null;
    setSession(nextSession);
    setUser(nextUser);
    setProfileLoading(Boolean(nextUser));
    if (!nextUser) setProfile(null);
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
      setProfileLoading(false);
      return undefined;
    }

    let cancelled = false;
    setProfileLoading(true);

    const loadProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('display_name,role')
          .eq('user_id', user.id)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.warn('User profile unavailable:', error.message);
          setProfile(null);
          return;
        }

        setProfile(data || null);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
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

  const role = profile?.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.MANAGER;
  const isAdmin = role === UserRole.ADMIN;

  const value = useMemo(() => ({
    user,
    session,
    profile,
    displayName,
    role,
    isAdmin,
    loading,
    profileLoading,
    isSupabaseConfigured,
    signUp,
    signIn,
    signOut,
  }), [user, session, profile, displayName, role, isAdmin, loading, profileLoading, signUp, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
