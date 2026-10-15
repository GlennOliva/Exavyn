import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { clearAttemptStorage } from '../attempts/storage';
import type { AppRole } from '../../lib/database.types';
import {
  loadSessionUser,
  signIn as signInApi,
  signOut as signOutApi,
  signUp as signUpApi,
  sendPasswordReset,
  updatePassword,
  type SessionUser,
} from './api';

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: SessionUser | null;
  error: string | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ session: Session | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  hasRole: (...roles: AppRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const knownUserIdRef = useRef<string | null>(null);
  const hydratedOnceRef = useRef(false);

  const hydrate = useCallback(async (activeSession: Session | null) => {
    // Clear any locally cached attempt/resume state when the signed-in identity
    // changes (sign-out or account switch) so a previous student's in-progress
    // attempt or controller token can never leak to the next account. The very
    // first hydration on page load is exempt so a reload can still resume.
    const nextUserId = activeSession?.user?.id ?? null;
    if (hydratedOnceRef.current && knownUserIdRef.current !== nextUserId) {
      clearAttemptStorage();
    }
    hydratedOnceRef.current = true;
    knownUserIdRef.current = nextUserId;

    setSession(activeSession);
    if (!activeSession?.user) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const sessionUser = await loadSessionUser(activeSession.user.id);
      setUser(sessionUser);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) void hydrate(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      void hydrate(nextSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [hydrate]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await hydrate(data.session);
  }, [hydrate]);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user,
      error,
      refresh,
      signIn: async (email, password) => {
        await signInApi(email, password);
      },
      signUp: (email, password, fullName) => signUpApi(email, password, fullName),
      signOut: async () => {
        await signOutApi();
        clearAttemptStorage();
        knownUserIdRef.current = null;
        setUser(null);
        setSession(null);
      },
      requestPasswordReset: sendPasswordReset,
      changePassword: updatePassword,
      hasRole: (...roles: AppRole[]) => (user ? roles.includes(user.role) : false),
    }),
    [loading, session, user, error, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
