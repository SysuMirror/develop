import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api } from './api';
import type { Me } from './types';

export interface AuthValue {
  user: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  loginWithPassword: (email: string, password: string) => Promise<Me | null>;
  loginWithDev: (userId: string) => Promise<Me | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * 首屏登录探测：先看本地会话；没有则用 .ssemarket.cn 的共享 Cookie 静默向 UniSSO 换身份。
 * 结果三态：
 *   ok     → 直接进站（用户可能在集市/iwiki/join 等处登录过）
 *   401    → 落登录页
 *   503/网络 → 保留现状，不把用户当登出
 */
async function probeLogin(): Promise<Me | null> {
  try {
    return await api.get<Me>('/auth/me');
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  try {
    await api.post('/auth/sso/try');
    return await api.get<Me>('/auth/me');
  } catch (error) {
    if (error instanceof ApiError && [401, 429, 503].includes(error.status)) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<Me | null> => {
    const me = await api.get<Me>('/auth/me');
    setUser(me);
    return me;
  }, []);

  useEffect(() => {
    probeLogin()
      .then((me) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const loginWithPassword = useCallback(
    async (email: string, password: string): Promise<Me | null> => {
      await api.post('/auth/login', { email, password });
      return refresh();
    },
    [refresh],
  );

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

  const value = useMemo(
    () => ({ user, loading, refresh, loginWithPassword, loginWithDev, logout }),
    [user, loading, refresh, loginWithPassword, loginWithDev, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
