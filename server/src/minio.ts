// 集市云对象存储（MinIO，S3 兼容）的最小客户端。
//
// 只实现项目附件需要的四个动作：PUT / DELETE / 预签名 GET / 配置检查。
// 不引第三方 SDK：SigV4 用 node:crypto 直接算，避免为了几个请求拉一整套 AWS SDK。
//
// 凭据来自部署平台注入的 MINIO_ENDPOINT / MINIO_BUCKET / MINIO_ACCESS_KEY / MINIO_SECRET；
// 缺任何一个时 storageConfigured() 为 false，附件接口返回 503（项目其他功能不受影响）。

import crypto from 'node:crypto';

const ENDPOINT = (process.env.MINIO_ENDPOINT || '').replace(/\/+$/, '');
const BUCKET = process.env.MINIO_BUCKET || '';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY || '';
const SECRET_KEY = process.env.MINIO_SECRET || '';
const REGION = process.env.MINIO_REGION || 'us-east-1';

export function storageConfigured(): boolean {
  return Boolean(ENDPOINT && BUCKET && ACCESS_KEY && SECRET_KEY);
}

export class StorageError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
  }
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/** RFC3986：encodeURIComponent 不编码 ! ' ( ) *，S3 要求编码。 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/');
}

function amzNow(): { amz: string; date: string } {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amz: iso, date: iso.slice(0, 8) };
}

function signingKey(date: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, date), REGION), 's3'), 'aws4_request');
}

function objectUrl(key: string, query = ''): URL {
  return new URL(`${ENDPOINT}/${encodeRfc3986(BUCKET)}/${encodeKeyPath(key)}${query ? `?${query}` : ''}`);
}

/** 把对象写进存储桶；body 已在内存里（接口侧限制 20MB）。 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const url = objectUrl(key);
  const { amz, date } = amzNow();
  const payloadHash = sha256Hex(body);
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const signature = crypto.createHmac('sha256', signingKey(date)).update(stringToSign).digest('hex');
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-amz-date': amz,
      'x-amz-content-sha256': payloadHash,
      authorization,
      'content-type': contentType || 'application/octet-stream',
      'content-length': String(body.length),
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new StorageError(`对象存储写入失败：HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
}

export async function deleteObject(key: string): Promise<void> {
  const url = objectUrl(key);
  const { amz, date } = amzNow();
  const payloadHash = sha256Hex('');
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `DELETE\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const signature = crypto.createHmac('sha256', signingKey(date)).update(stringToSign).digest('hex');
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: { 'x-amz-date': amz, 'x-amz-content-sha256': payloadHash, authorization },
    signal: AbortSignal.timeout(15_000),
  });
  // 删除幂等：404 也当成功。
  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text().catch(() => '');
    throw new StorageError(`对象存储删除失败：HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
}

export interface PresignOptions {
  expiresSeconds?: number;
  /** attachment 触发下载；inline 用浏览器预览。 */
  disposition?: 'inline' | 'attachment';
  filename?: string;
  contentType?: string;
}

export interface ObjectStream {
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
  contentLength: number | null;
}

/**
 * 读取对象并返回可转发的流。
 * 集市云的 MinIO 只有集群内地址，浏览器访问不到，所以附件统一由应用代理转发，
 * 不把内部地址写进预签名 URL。
 */
export async function getObject(key: string): Promise<ObjectStream> {
  const url = objectUrl(key);
  const { amz, date } = amzNow();
  const payloadHash = sha256Hex('');
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `GET\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const signature = crypto.createHmac('sha256', signingKey(date)).update(stringToSign).digest('hex');
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const resp = await fetch(url, {
    headers: { 'x-amz-date': amz, 'x-amz-content-sha256': payloadHash, authorization },
    signal: AbortSignal.timeout(30_000),
  });
  if (resp.status === 404) throw new StorageError('对象不存在', 404);
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    throw new StorageError(`对象读取失败：HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  const length = Number(resp.headers.get('content-length'));
  return {
    body: resp.body,
    contentType: resp.headers.get('content-type'),
    contentLength: Number.isFinite(length) ? length : null,
  };
}

/** 生成预签名 GET 链接：浏览器直接读存储，不经过应用进程。 */
export function presignGet(key: string, options: PresignOptions = {}): string {
  const expires = Math.min(Math.max(options.expiresSeconds ?? 3600, 60), 7 * 86400);
  const { amz, date } = amzNow();
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const query: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${ACCESS_KEY}/${scope}`],
    ['X-Amz-Date', amz],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  if (options.disposition) {
    const filename = (options.filename || 'file').replace(/["\\\r\n]/g, '_');
    query.push([
      'response-content-disposition',
      `${options.disposition}; filename*=UTF-8''${encodeRfc3986(filename)}`,
    ]);
  }
  if (options.contentType) query.push(['response-content-type', options.contentType]);
  query.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalQuery = query.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join('&');
  const url = objectUrl(key);
  const canonicalRequest = `GET\n${url.pathname}\n${canonicalQuery}\nhost:${url.host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const signature = crypto.createHmac('sha256', signingKey(date)).update(stringToSign).digest('hex');
  return `${ENDPOINT}/${encodeRfc3986(BUCKET)}/${encodeKeyPath(key)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
