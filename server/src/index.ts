import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as auth from './auth.ts';
import { parseCookies, wrap } from './http.ts';
import { pool } from './db.ts';
import { warm as warmDirectory } from './directory.ts';
import appliesRouter from './routes/applies.ts';
import demandsRouter from './routes/demands.ts';
import joinRouter from './routes/join.ts';
import projectsRouter from './routes/projects.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));
  app.use((req, _res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });
  // Express 4 不会捕获 async 处理器的 rejection，未包裹的失败会直接让进程退出。
  app.use(wrap(auth.attachSession));

  app.get(
    '/api/health',
    wrap(async (_req, res) => {
      try {
        await pool.query('SELECT 1');
        res.json({
          ok: true,
          db: 'up',
          sso: auth.ssoConfigured(),
          devLogin: auth.devLoginEnabled(),
          developerGate: true,
        });
      } catch (error) {
        res.status(503).json({
          ok: false,
          db: 'down',
          message: messageOf(error),
        });
      }
    }),
  );

  // 跳转授权入口（GET）；external 应用不支持邮箱密码登录，故没有 POST 版本。
  app.get('/api/auth/login', wrap(auth.login));
  app.all('/api/auth/login', (_req, res) => {
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '登录只支持 GET 跳转授权' } });
  });
  app.get('/api/auth/callback', wrap(auth.callback));
  app.get('/api/auth/me', wrap(auth.me));
  app.post('/api/auth/logout', wrap(auth.logout));
  app.get('/api/auth/dev/identities', wrap(auth.devIdentities));
  app.post('/api/auth/dev-login', wrap(auth.devLogin));

  // join 平台是后端到后端调用，不走 UniSSO 会话，自己用共享密钥鉴权。
  app.use('/api/join', joinRouter);

  app.use('/api', auth.requireUser);
  // 开发者业务要求 UniSSO userinfo 的 developer 严格为 true（DEV_LOGIN 会话除外）。
  app.use('/api', wrap(auth.requireDeveloper));
  app.use('/api', projectsRouter);
  app.use('/api', appliesRouter);
  app.use('/api', demandsRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  // 构建产物可能在进程启动之后才产生，因此每次请求再判断，避免必须重启。
  const indexHtml = path.join(webDist, 'index.html');
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    if (fs.existsSync(indexHtml)) {
      res.sendFile(indexHtml);
      return;
    }
    res.type('text/plain').send('前端尚未构建，请先在 web/ 目录运行 npm run build。');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = Number((err as { status?: unknown } | null)?.status) || 500;
    const rawCode = (err as { code?: unknown } | null)?.code;
    const code = (typeof rawCode === 'string' && rawCode) || (status === 500 ? 'INTERNAL' : 'ERROR');
    if (status >= 500) {
      console.error('[error]', err);
    }
    res.status(status).json({ error: { code, message: status >= 500 ? '服务器开小差了' : messageOf(err) } });
  });

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 兜底：任何漏网的 rejection / exception 只记日志，不让长驻进程退出。
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('[uncaughtException]', error);
  });
  const port = Number(process.env.PORT || 8080);
  createApp().listen(port, '0.0.0.0', () => {
    console.log(`api listening on 0.0.0.0:${port}`);
  });
  // 目录预热在后台跑，失败也不会影响启动；请求路径永远不等待它。
  warmDirectory();
  // 全局开发者资格的唯一写入方是 join（UniSSO 白名单只放行 join 的 client）；
  // 本平台只读资格、按项目成员做业务权限，不再回写 is_developer。
}
