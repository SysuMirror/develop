import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setUser(me);
      return me;
    } catch (error) {
      if (error.status === 401) {
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

  const loginWithDev = useCallback(async (userId) => {
    await api.post('/auth/dev-login', { userId });
    return refresh();
  }, [refresh]);

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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
