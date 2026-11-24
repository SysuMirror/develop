import { query } from './db.ts';
import { qualificationWriteEnabled, updateDeveloperQualification } from './unisso.ts';

// 每个开发者只保留最新目标值；重试同一目标值即可，不需要补偿历史。
const MAX_ATTEMPTS = 20;
const BACKOFF_CAP_MS = 10 * 60_000;
const DEFAULT_RETRY_MS = 3000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let disabledLogged = false;

interface QualSyncRow {
  id: number;
  user_id: string;
  target_value: number | string | boolean;
  attempts: number | string;
}

/** 错误上挂的重试元信息：retryable === false 表示重试也不会变好。 */
interface RetryableError extends Error {
  retryable?: boolean;
  retryAfterMs?: number;
}

function errorMeta(error: unknown): RetryableError {
  if (error instanceof Error) return error as RetryableError;
  return new Error(String(error));
}

function toMysqlDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function backoffMs(attempts: number, retryAfterMs = 0): number {
  const exponential = Math.min(DEFAULT_RETRY_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
  return Math.max(exponential, retryAfterMs);
}

export async function enqueueQualification(userId: string | null | undefined, targetValue: boolean): Promise<void> {
  if (!userId) return;
  // 资格写入唯一责任人 = join（UniSSO 侧只把 join 的 client 列进写白名单）。
  // 本平台不再入队，避免「join 授予 / develop 撤销」互相覆盖。
  if (!qualificationWriteEnabled()) return;
  await query(
    `INSERT INTO developer_qual_sync (user_id, target_value, status, attempts, last_error, next_attempt_at)
     VALUES (?, ?, 'pending', 0, NULL, NOW())
     ON DUPLICATE KEY UPDATE
       target_value = VALUES(target_value),
       status = 'pending',
       attempts = 0,
       last_error = NULL,
       next_attempt_at = NOW()`,
    [userId, targetValue ? 1 : 0],
  );
  // 立即尝试一次，不阻塞调用方；失败由下一轮重试。
  void runQualSyncOnce().catch((error: unknown) => console.error('[qual-sync]', errorMeta(error).message));
}

// 被 leader 移除 / 退出 / 项目被删除后调用：只有确实不再属于任何项目才撤销资格。
export async function revokeIfNoMembership(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const [row] = await query<{ n: number | string }>('SELECT COUNT(*) AS n FROM project_member WHERE user_id = ?', [userId]);
  if (Number(row?.n ?? 0) > 0) return false;
  await enqueueQualification(userId, false);
  return true;
}

async function pushRow(row: QualSyncRow): Promise<void> {
  const target = Number(row.target_value) === 1;
  const result = await updateDeveloperQualification(row.user_id, target);
  if (result.developer !== target) {
    // 写入成功但读回值不一致（并发写入），按可重试处理，下一轮再写同一目标值。
    const error: RetryableError = new Error(`qualification mismatch: want ${target}, got ${result.developer}`);
    error.retryable = true;
    throw error;
  }
  await query("UPDATE developer_qual_sync SET status = 'done', last_error = NULL WHERE id = ?", [row.id]);
}

async function markFailure(row: QualSyncRow, error: unknown): Promise<void> {
  const meta = errorMeta(error);
  const attempts = Number(row.attempts) + 1;
  const terminal = meta.retryable === false || attempts >= MAX_ATTEMPTS;
  if (terminal) {
    await query("UPDATE developer_qual_sync SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", [
      attempts,
      meta.message.slice(0, 255),
      row.id,
    ]);
    console.error(`[qual-sync] user ${row.user_id} failed: ${meta.message}`);
    return;
  }
  const next = new Date(Date.now() + backoffMs(attempts, meta.retryAfterMs || 0));
  await query(
    `UPDATE developer_qual_sync
        SET attempts = ?, last_error = ?, next_attempt_at = ?
      WHERE id = ?`,
    [attempts, meta.message.slice(0, 255), toMysqlDate(next), row.id],
  );
}

export async function runQualSyncOnce(): Promise<void> {
  if (running) return;
  if (!qualificationWriteEnabled()) {
    if (!disabledLogged) {
      console.warn('[qual-sync] 未配置 SSO 凭证，资格写入暂停');
      disabledLogged = true;
    }
    return;
  }
  running = true;
  try {
    const rows = await query<QualSyncRow>(
      `SELECT id, user_id, target_value, attempts
         FROM developer_qual_sync
        WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY next_attempt_at, id
        LIMIT 20`,
    );
    for (const row of rows) {
      try {
        await pushRow(row);
      } catch (error) {
        await markFailure(row, error);
      }
    }
  } finally {
    running = false;
  }
}

export function startQualSyncWorker(): NodeJS.Timeout | null {
  const interval = Number(process.env.QUAL_SYNC_INTERVAL_MS ?? 15000);
  if (!Number.isFinite(interval) || interval <= 0) return null;
  if (timer) return timer;
  timer = setInterval(() => {
    void runQualSyncOnce().catch((error: unknown) => console.error('[qual-sync]', errorMeta(error).message));
  }, interval);
  // 不阻止进程退出；服务器本身由 listen 保活。
  timer.unref();
  return timer;
}
