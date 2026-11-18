// 部署自检：确认本平台的 client_id / client_secret 在 UniSSO 侧可用。
//
// 按规范用 introspect 探客户端鉴权（token 留空必须是 200 {"active":false}）。
// 不要用假 code 打 token 端点自检：那只会得到 invalid_grant，探不到客户端鉴权。
// 用法：npm run check:sso ；不符时非零退出，方便部署脚本回滚。
import 'dotenv/config';
import { ssoCredentials } from './sso-config.ts';

async function main(): Promise<void> {
  const { issuer, clientId, clientSecret } = ssoCredentials();
  if (!clientId || !clientSecret) {
    console.error('✗ 未配置 SSO_CLIENT_ID / SSO_CLIENT_SECRET');
    process.exit(1);
  }
  const url = `${issuer}/api/oauth/introspect`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token: '' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(`✗ ${url} 请求失败：`, error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  if (resp.status !== 200 || data.active !== false) {
    console.error(`✗ introspect 期望 200 {"active":false}，实际 ${resp.status} ${text.slice(0, 200)}`);
    console.error('  401 invalid_client 通常是 client_secret 不对或已被重置（secret 只在生成时显示一次）。');
    process.exit(1);
  }
  console.log(`✓ 客户端鉴权通过（client_id=${clientId}，issuer=${issuer}）`);
}

main().catch((error) => {
  console.error('✗ 自检异常：', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
