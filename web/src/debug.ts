import { useEffect, useState } from 'react';

// 自检页只在非生产环境开放，开关由服务端在 /api/health 里下发。
// 结果按模块缓存：导航和页面各查一次也只会发一个请求。
let cached: boolean | null = null;
let pending: Promise<boolean | null> | null = null;

function loadFlag(): Promise<boolean | null> {
  if (cached !== null) return Promise.resolve(cached);
  if (!pending) {
    pending = fetch('/api/health', { credentials: 'same-origin' })
      // DB 挂掉时 health 会返回 503，但开关字段仍在 body 里，所以不看 res.ok。
      .then((res) => res.json() as Promise<{ debug?: unknown } | null>)
      .then((body) => {
        cached = body?.debug === true;
        return cached;
      })
      .catch(() => {
        cached = false;
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useDebugEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(cached);
  useEffect(() => {
    let alive = true;
    loadFlag().then((value) => {
      if (alive) setEnabled(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}
