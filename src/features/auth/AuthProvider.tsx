import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { claimGuestDataForUser, clearLocalAccountData } from '@/data/accountData';
import { setSyncUser, syncNow } from '@/data/sync/syncEngine';
import { isBackendConfigured } from '@/lib/env';
import { prefs, PREF_KEYS } from '@/lib/prefs';
import { getSupabase } from '@/lib/supabase';

import { signOutSocial } from './socialSignIn';

interface AuthState {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  /** Native only: user chose to use the app without an account (local data only). */
  isGuest: boolean;
  /** Whether the main app (tabs, rounds) may be shown. */
  canEnterApp: boolean;
  continueAsGuest(): void;
  /** Leaves guest mode and returns to the sign-in screen without touching local data. */
  showSignIn(): void;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isBackendConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [guestChosen, setGuestChosen] = useState(() => prefs.get(PREF_KEYS.guestChosen) === '1');

  useEffect(() => {
    if (!isBackendConfigured) return;
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  // When an account becomes active on this device: adopt guest rounds, then start syncing.
  useEffect(() => {
    if (!userId) {
      setSyncUser(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      await claimGuestDataForUser(userId);
      if (!cancelled) setSyncUser(userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const continueAsGuest = useCallback(() => {
    prefs.set(PREF_KEYS.guestChosen, '1');
    setGuestChosen(true);
  }, []);

  const showSignIn = useCallback(() => {
    prefs.set(PREF_KEYS.guestChosen, null);
    setGuestChosen(false);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const { data, error } = await getSupabase().auth.signUp({ email, password });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }, []);

  const finishSignOut = useCallback(async () => {
    await clearLocalAccountData();
    await signOutSocial();
    await getSupabase().auth.signOut();
    prefs.set(PREF_KEYS.guestChosen, null);
    setGuestChosen(false);
  }, []);

  const signOut = useCallback(async () => {
    await syncNow(); // upload any pending edits before the local copy is removed
    await finishSignOut();
  }, [finishSignOut]);

  const deleteAccount = useCallback(async () => {
    const { error } = await getSupabase().functions.invoke('delete-account', { method: 'POST' });
    if (error) throw error;
    await finishSignOut();
  }, [finishSignOut]);

  const value = useMemo<AuthState>(() => {
    const isGuest = Platform.OS !== 'web' && !session && guestChosen;
    return {
      ready,
      session,
      userId,
      isGuest,
      canEnterApp: !!session || isGuest,
      continueAsGuest,
      showSignIn,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      deleteAccount,
    };
  }, [ready, session, userId, guestChosen, continueAsGuest, showSignIn, signInWithEmail, signUpWithEmail, signOut, deleteAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
