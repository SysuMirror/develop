import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useDebugEnabled } from '../debug';
import { Badge, Skeleton, displayName, useToast } from '../ui';
import type { Tone } from '../ui';

const TIMEOUT_MS = 15_000;
const BODY_LIMIT = 8_000;

type ProbeState = 'idle' | 'running' | 'done' | 'skipped' | 'error';

// 接口响应统一按 JSON 值处理，避免把 unknown 一路传到展示层。
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface ProbeResult {
  state: ProbeState;
  path?: string;
  status?: number;
  ok?: boolean;
  ms?: number;
  code?: string;
  body?: JsonValue;
  text?: string;
  error?: string;
  skip?: string;
  at?: string;
}

type Derived = { path: string } | { skip: string };

interface Probe {
  id: string;
  group: string;
  label: string;
  note?: string;
  path?: string;
  // 依赖前一条结果的探针（例如详情需要列表里的 id），拿不到就跳过而不是算失败。
  derive?: (results: Record<string, ProbeResult>) => Derived;
  external?: string;
}

function bodyOf(result: ProbeResult | undefined): JsonValue {
  return result?.body ?? null;
}

function field(value: JsonValue, key: string): JsonValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value[key] ?? null;
}

function firstItemId(result: ProbeResult | undefined): number | null {
  const items = field(bodyOf(result), 'items');
  if (!Array.isArray(items)) return null;
  const id = field(items[0] ?? null, 'id');
  return typeof id === 'number' ? id : null;
}

function currentUserId(result: ProbeResult | undefined): string | null {
  const id = field(bodyOf(result), 'id');
  return typeof id === 'string' && id ? id : null;
}

const PROBES: Probe[] = [
  {
    id: 'health',
    group: '健康检查',
    label: '健康检查',
    path: '/health',
    note: 'DB / SSO / DEV_LOGIN / 自检开关',
  },
  {
    id: 'auth-me',
    group: '认证',
    label: '当前会话',
    path: '/auth/me',
    note: '401 = 未登录；403 NOT_DEVELOPER = 无开发者资格',
  },
  {
    id: 'dev-identities',
    group: '认证',
    label: '演示身份',
    path: '/auth/dev/identities',
    note: '仅 DEV_LOGIN 开启时才有内容',
  },
  {
    id: 'users',
    group: '用户',
    label: '用户目录',
    path: '/users?page=1&pageSize=5',
  },
  {
    id: 'user-detail',
    group: '用户',
    label: '用户详情',
    derive: (results) => {
      const id = currentUserId(results['auth-me']);
      if (!id) return { skip: '先运行「当前会话」拿到用户 id' };
      return { path: `/users/${encodeURIComponent(id)}` };
    },
  },
  {
    id: 'projects',
    group: '项目',
    label: '项目列表',
    path: '/projects?page=1&pageSize=5',
  },
  {
    id: 'project-detail',
    group: '项目',
    label: '项目详情',
    derive: (results) => {
      const id = firstItemId(results.projects);
      if (!id) return { skip: '项目列表里没有可用项目' };
      return { path: `/projects/${id}` };
    },
  },
  {
    id: 'applies-mine',
    group: '申请',
    label: '我的申请',
    path: '/applies/mine',
  },
  {
    id: 'applies-inbox',
    group: '申请',
    label: '待我审批',
    path: '/applies/inbox',
  },
  {
    id: 'demands',
    group: '需求',
    label: '需求列表',
    path: '/demands?page=1&pageSize=5',
  },
  {
    id: 'join-projects',
    group: '外部接入',
    label: 'join 项目发现',
    external: '服务端到服务端接口，需要 JOIN_API_KEY；浏览器拿不到，故不执行',
  },
];

async function runProbe(probe: Probe, results: Record<string, ProbeResult>): Promise<ProbeResult> {
  if (probe.external) return { state: 'skipped', skip: probe.external };
  const derived: Derived = probe.derive ? probe.derive(results) : { path: probe.path ?? '' };
  if ('skip' in derived) return { state: 'skipped', skip: derived.skip };
  const path = derived.path;
  const at = new Date().toLocaleTimeString('zh-CN');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const raw = await res.text();
    const ms = Math.round(performance.now() - started);
    let body: JsonValue = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }
    const code = field(field(body, 'error'), 'code');
    return {
      state: 'done',
      path,
      status: res.status,
      ok: res.ok,
      ms,
      code: typeof code === 'string' ? code : undefined,
      body,
      text: raw.length > BODY_LIMIT ? `${raw.slice(0, BODY_LIMIT)}\n…（已截断，原始 ${raw.length} 字符）` : raw,
      at,
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return {
      state: 'error',
      path,
      ms: Math.round(performance.now() - started),
      error: aborted ? `请求超时（${TIMEOUT_MS / 1000}s）` : error instanceof Error ? error.message : String(error),
      at,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

function statusTone(result: ProbeResult | undefined): Tone {
  if (!result || result.state === 'idle') return 'gray';
  if (result.state === 'running') return 'blue';
  if (result.state === 'skipped') return 'gray';
  if (result.state === 'error') return 'red';
  if (result.ok) return 'green';
  // 401 / 403 多半是登录或资格问题，和 5xx 区分开。
  if (result.status === 401 || result.status === 403) return 'amber';
  return 'red';
}

function statusLabel(result: ProbeResult | undefined): string {
  if (!result || result.state === 'idle') return '未运行';
  if (result.state === 'running') return '运行中';
  if (result.state === 'skipped') return '跳过';
  if (result.state === 'error') return '网络错误';
  if (result.status === undefined) return '无响应';
  return `${result.status} ${result.ok ? 'OK' : '失败'}`;
}

function summaryOf(result: ProbeResult | undefined): string {
  if (!result || result.state === 'idle') return '—';
  if (result.state === 'running') return '…';
  if (result.state === 'skipped') return result.skip ?? '跳过';
  if (result.state === 'error') return result.error ?? '网络错误';
  if (result.code) return result.code;
  const body = bodyOf(result);
  if (body === null) return result.text ? result.text.slice(0, 80) : '空响应';
  if (Array.isArray(body)) return `数组 ${body.length} 项`;
  if (typeof body === 'object') {
    const items = field(body, 'items');
    if (Array.isArray(items)) {
      const total = field(body, 'total');
      return `items ${items.length} / total ${typeof total === 'number' ? total : '—'}`;
    }
    const keys = Object.keys(body);
    return keys.length ? keys.slice(0, 6).join(', ') : '空对象';
  }
  return String(body).slice(0, 80);
}

function prettyBody(result: ProbeResult | undefined): string {
  if (!result) return '';
  if (result.text) {
    if (result.body === null) return result.text;
    try {
      return JSON.stringify(result.body, null, 2);
    } catch {
      return result.text;
    }
  }
  return result.error ?? result.skip ?? '';
}

function curlOf(path: string): string {
  return `curl -sS -H 'Accept: application/json' -b '<会话 cookie>' '${window.location.origin}/api${path}'`;
}

export default function DebugApiPage() {
  const debug = useDebugEnabled();
  const { user, loading } = useAuth();
  const { push } = useToast();
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const resultsRef = useRef<Record<string, ProbeResult>>({});

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const stats = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const probe of PROBES) {
      const result = results[probe.id];
      if (!result) continue;
      if (result.state === 'skipped') skipped += 1;
      else if (result.state === 'error' || (result.state === 'done' && !result.ok)) failed += 1;
      else if (result.state === 'done') passed += 1;
    }
    return { passed, failed, skipped };
  }, [results]);

  async function runAll() {
    setRunning(true);
    setExpanded(null);
    setTotalMs(null);
    const acc: Record<string, ProbeResult> = {};
    setResults({});
    resultsRef.current = {};
    const started = performance.now();
    for (const probe of PROBES) {
      if (!probe.external) {
        setResults({ ...acc, [probe.id]: { state: 'running' } });
      }
      const result = await runProbe(probe, acc);
      acc[probe.id] = result;
      resultsRef.current = acc;
      setResults({ ...acc });
    }
    setTotalMs(Math.round(performance.now() - started));
    setRunning(false);
  }

  async function runSingle(probe: Probe) {
    const acc = resultsRef.current;
    setResults({ ...acc, [probe.id]: { state: 'running' } });
    const result = await runProbe(probe, acc);
    const next = { ...acc, [probe.id]: result };
    resultsRef.current = next;
    setResults(next);
  }

  function reset() {
    resultsRef.current = {};
    setResults({});
    setExpanded(null);
    setTotalMs(null);
  }

  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      push(message, 'success');
    } catch {
      push('复制失败，请手动选中文本', 'error');
    }
  }

  if (debug === null) return <Skeleton rows={5} />;

  if (!debug) {
    return (
      <div>
        <h1 className="page-title">接口自检</h1>
        <p className="page-sub">只读巡检后端接口，用于排查登录、资格、数据库与外部接入问题。</p>
        <div className="notice notice-error" style={{ marginTop: 20 }}>
          当前环境未开放自检页。仅在 <span className="mono">NODE_ENV</span> 不为{' '}
          <span className="mono">production</span> 或开启 <span className="mono">DEV_LOGIN</span> 时可用；
          <span className="mono">DEBUG_API=0</span> 可强制关闭。
        </div>
      </div>
    );
  }

  const health = results.health;
  const healthDb = field(bodyOf(health), 'db');
  const healthSso = field(bodyOf(health), 'sso');
  const healthDevLogin = field(bodyOf(health), 'devLogin');

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">接口自检</h1>
          <p className="page-sub">
            只读巡检：全部是 GET，使用当前浏览器会话，不会修改任何数据。状态码和错误码按真实接口返回展示。
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h3>执行上下文</h3>
          <Badge tone="green">自检已开启</Badge>
        </div>
        <div className="probe-meta">
          <div>
            <span className="faint">当前会话</span>{' '}
            {loading ? '读取中…' : user ? `${displayName(user)}（${user.id}）` : '未登录'}
          </div>
          <div>
            <span className="faint">开发者资格</span>{' '}
            {user ? (user.developer ? `有（${user.qualification}）` : `无（${user.qualification}）`) : '—'}
          </div>
          <div>
            <span className="faint">DB</span> {typeof healthDb === 'string' ? healthDb : '—'}
            <span className="faint" style={{ marginLeft: 14 }}>
              SSO
            </span>{' '}
            {typeof healthSso === 'boolean' ? (healthSso ? '已配置' : '未配置') : '—'}
            <span className="faint" style={{ marginLeft: 14 }}>
              DEV_LOGIN
            </span>{' '}
            {typeof healthDevLogin === 'boolean' ? (healthDevLogin ? '开' : '关') : '—'}
          </div>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={runAll} disabled={running}>
          {running ? '巡检中…' : '运行全部'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={reset} disabled={running}>
          清空
        </button>
        <span className="row" style={{ gap: 8 }}>
          <Badge tone="green">通过 {stats.passed}</Badge>
          <Badge tone={stats.failed ? 'red' : 'gray'}>失败 {stats.failed}</Badge>
          <Badge tone="gray">跳过 {stats.skipped}</Badge>
        </span>
        {totalMs !== null ? <span className="faint">总耗时 {totalMs} ms</span> : null}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>分组</th>
              <th>接口</th>
              <th>状态</th>
              <th>耗时</th>
              <th>摘要</th>
              <th className="right">操作</th>
            </tr>
          </thead>
          <tbody>
            {PROBES.map((probe) => {
              const result = results[probe.id];
              const isOpen = expanded === probe.id;
              const canShow = result?.state === 'done' || result?.state === 'error' || result?.state === 'skipped';
              return (
                <Fragment key={probe.id}>
                  <tr>
                    <td className="faint">{probe.group}</td>
                    <td>
                      <div className="cell-title">{probe.label}</div>
                      <div className="mono faint">GET {result?.path ?? probe.path ?? '—'}</div>
                      {probe.note ? <div className="faint">{probe.note}</div> : null}
                    </td>
                    <td>
                      <Badge tone={statusTone(result)}>{statusLabel(result)}</Badge>
                    </td>
                    <td className="faint">{result?.ms === undefined ? '—' : `${result.ms} ms`}</td>
                    <td className="probe-summary">{summaryOf(result)}</td>
                    <td>
                      <div className="actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={running || result?.state === 'running' || Boolean(probe.external)}
                          onClick={() => runSingle(probe)}
                        >
                          运行
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={!canShow}
                          onClick={() => setExpanded(isOpen ? null : probe.id)}
                        >
                          {isOpen ? '收起' : '详情'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={!result?.path}
                          onClick={() => copy(curlOf(result?.path ?? ''), '已复制 curl（需自行带上会话 cookie）')}
                        >
                          curl
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr key={`${probe.id}-body`}>
                      <td colSpan={6} style={{ background: 'var(--bg)' }}>
                        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                          <span className="faint">
                            {result?.at ? `运行于 ${result.at}` : ''}
                            {result?.code ? ` · 错误码 ${result.code}` : ''}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => copy(prettyBody(result), '已复制响应')}
                          >
                            复制响应
                          </button>
                        </div>
                        <pre className="probe-body">{prettyBody(result) || '（空）'}</pre>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="faint" style={{ marginTop: 12 }}>
        提示：401 说明会话无效，403 NOT_DEVELOPER 说明开发者资格未通过，5xx 多为数据库或上游 SSO 故障。
        join 接口不接受浏览器会话，需要带 JOIN_API_KEY 用 curl 单独验证。
      </p>
    </div>
  );
}
