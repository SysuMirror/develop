import mysql from 'mysql2/promise';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'mysql.platform-infra.svc.cluster.local',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: 'Z',
  supportBigNumbers: true,
});

/** 查询多行。调用方自己声明行类型（见 src/types.ts）。 */
export async function query<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  // SAFETY: mysql2 把行返回成 RowDataPacket[]，列名与调用方声明的行类型一一对应（SQL 是手写的字符串，
  // 类型系统看不到列）；唯一保证是这里的 SQL 与 T 同步维护，与微信 web 端的 types.ts 同理。
  return rows as unknown as T[];
}

/** 查询单行，没有就是 null。 */
export async function one<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** 写操作，返回 affectedRows / insertId。 */
export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await pool.query(sql, params);
  return result as ResultSetHeader;
}

/** 唯一键撞车（ER_DUP_ENTRY）。mysql2 抛的错带 code，不依赖 errno 数值。 */
export function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
}

export async function withTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
