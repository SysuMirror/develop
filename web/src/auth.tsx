import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api } from './api';
import type { Me } from './types';

export interface AuthValue {
  user: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  loginWithDev: (userId: string) => Promise<Me | null>;
  logout: () => Promise<void>;
  loginUrl: string;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<Me | null> => {
    try {
      const me = await api.get<Me>('/auth/me');
      setUser(me);
      return me;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        return null;
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const loginWithDev = useCallback(
    async (userId: string): Promise<Me | null> => {
      await api.post('/auth/dev-login', { userId });
      return refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const loginUrl = useMemo(() => {
    const here = window.location.pathname + window.location.search;
    return `/api/auth/login?redirect=${encodeURIComponent(here)}`;
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, loginWithDev, logout, loginUrl }),
    [user, loading, refresh, loginWithDev, logout, loginUrl],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
