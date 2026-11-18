// UniSSO 连接配置：认证流程与用户目录共用这一份解析结果。
const ISSUER = (process.env.SSO_ISSUER || 'https://sso.ssemarket.cn').replace(/\/+$/, '');
const CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';

export interface SsoCredentials {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export const ssoCredentials = (): SsoCredentials => ({
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

export const ssoConfigured = (): boolean => Boolean(CLIENT_ID && CLIENT_SECRET);

// 没配 SSO 凭证时默认走开发登录；显式 DEV_LOGIN=1 也能在配了凭证时强制打开。
export const devLoginEnabled = (): boolean =>
  process.env.DEV_LOGIN !== '0' && (!ssoConfigured() || process.env.DEV_LOGIN === '1');
