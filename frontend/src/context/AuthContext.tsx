import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser } from '@hgv/shared';
import { api, ApiError } from '../services/api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthValue {
  user: PublicUser | null;
  status: Status;
  /** Set when the session check itself failed (for example, the server is down). */
  error: string | null;
  login(input: { email: string; password: string }): Promise<void>;
  register(input: { name: string; email: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  setUser(user: PublicUser): void;
  /** Called when the server says the session is no longer valid. */
  expire(): void;
  retry(): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api
      .me()
      .then(({ user }) => {
        if (cancelled) return;
        setUserState(user);
        setStatus('authenticated');
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setUserState(null);
        setStatus('anonymous');
        // 401 just means "not signed in". Anything else is a real problem worth showing.
        setError(err instanceof ApiError && err.code !== 'UNAUTHENTICATED' ? err.message : null);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const { user } = await api.login(input);
    setUserState(user);
    setStatus('authenticated');
    setError(null);
  }, []);

  const register = useCallback(async (input: { name: string; email: string; password: string }) => {
    const { user } = await api.register(input);
    setUserState(user);
    setStatus('authenticated');
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUserState(null);
      setStatus('anonymous');
    }
  }, []);

  const expire = useCallback(() => {
    setUserState(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      error,
      login,
      register,
      logout,
      setUser: setUserState,
      expire,
      retry: () => setAttempt((n) => n + 1),
    }),
    [user, status, error, login, register, logout, expire],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
