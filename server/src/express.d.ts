// Express 的 Request 在两条中间件之后才有这些字段，用声明合并补上类型。
import type { SessionUser } from './types.ts';

declare global {
  namespace Express {
    interface Request {
      /** parseCookies() 的结果，由 createApp 的中间件填入。 */
      cookies: Record<string, string>;
      /** attachSession 填入；未登录为 null。 */
      user: SessionUser | null;
    }
  }
}

export {};
