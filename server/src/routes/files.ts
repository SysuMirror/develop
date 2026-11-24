// 项目附件：字节存集市云对象存储（MinIO），MySQL 只存元数据。
// 权限与“开发说明”一致：项目成员可见、可上传；删除限上传者本人或 leader。

import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { loadMembership, loadProject } from '../access.ts';
import { execute, query } from '../db.ts';
import { getUsers, userRef } from '../directory.ts';
import { ApiError, badRequest, forbidden, notFound, wrap } from '../http.ts';
import { deleteObject, getObject, putObject, StorageError, storageConfigured } from '../minio.ts';

const router = Router();

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES_PER_PROJECT = 100;

interface FileRow extends RowDataPacket {
  id: number;
  project_id: number;
  name: string;
  size: number | string;
  content_type: string | null;
  object_key: string;
  uploaded_by: string;
  created_at: Date;
}

const FILE_COLUMNS = 'id, project_id, name, size, content_type, object_key, uploaded_by, created_at';

function fileUrls(projectId: number, fileId: number): { previewUrl: string; downloadUrl: string } {
  const base = `/api/projects/${projectId}/files/${fileId}/raw`;
  return { previewUrl: `${base}?mode=preview`, downloadUrl: `${base}?mode=download` };
}

function safeFilename(raw: unknown): string {
  const value = String(raw ?? '').trim().replace(/[\\/\r\n"]/g, '_');
  return (value || 'file').slice(0, 200);
}

function objectKey(projectId: number, name: string): string {
  const ext = (name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();
  return `projects/${projectId}/${Date.now()}-${crypto.randomUUID()}${ext}`;
}

async function readBody(req: import('express').Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > MAX_FILE_BYTES) throw badRequest('FILE_TOO_LARGE', '单个文件不能超过 20MB');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** 成员才能读写附件；非成员按“不存在”处理，避免泄露项目是否存在附件。 */
async function requireProjectMember(projectId: unknown, userId: string): Promise<void> {
  const project = await loadProject(projectId);
  if (!(await loadMembership(project.id, userId))) throw forbidden('NOT_MEMBER', '只有项目成员可以查看附件');
}

router.get(
  '/projects/:id/files',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireProjectMember(req.params.id, user.id);
    const projectId = Number(req.params.id);
    const rows = await query<FileRow>(`SELECT ${FILE_COLUMNS} FROM project_file WHERE project_id = ? ORDER BY id DESC`, [
      projectId,
    ]);
    const people = await getUsers(rows.map((row) => row.uploaded_by));
    res.json({
      storage: storageConfigured() ? 'minio' : 'unavailable',
      maxFileBytes: MAX_FILE_BYTES,
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        size: Number(row.size),
        contentType: row.content_type,
        uploadedBy: userRef(row.uploaded_by, people.get(row.uploaded_by)),
        createdAt: row.created_at,
        ...fileUrls(projectId, row.id),
      })),
    });
  }),
);

router.post(
  '/projects/:id/files',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    if (!storageConfigured()) throw new ApiError(503, 'STORAGE_UNAVAILABLE', '对象存储未配置，暂不能上传附件');
    const project = await loadProject(req.params.id);
    if (!(await loadMembership(project.id, user.id))) throw forbidden('NOT_MEMBER', '只有项目成员可以上传附件');

    const [counted] = await query<{ n: number | string }>('SELECT COUNT(*) AS n FROM project_file WHERE project_id = ?', [
      project.id,
    ]);
    if (Number(counted?.n ?? 0) >= MAX_FILES_PER_PROJECT) {
      throw badRequest('TOO_MANY_FILES', `每个项目最多 ${MAX_FILES_PER_PROJECT} 个附件`);
    }

    const name = safeFilename(req.query.name);
    // 前端统一用 application/octet-stream 上传，真实类型放 x-file-type，
    // 避免 express.json 把 .json 附件当请求体解析掉。
    const contentType = String(req.headers['x-file-type'] || req.headers['content-type'] || 'application/octet-stream')
      .slice(0, 120);
    const body = await readBody(req);
    if (body.length === 0) throw badRequest('EMPTY_FILE', '文件是空的');

    const key = objectKey(project.id, name);
    try {
      await putObject(key, body, contentType);
    } catch (error) {
      if (error instanceof StorageError) throw new ApiError(502, 'STORAGE_ERROR', error.message);
      throw error;
    }
    const result = await execute(
      'INSERT INTO project_file (project_id, name, size, content_type, object_key, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
      [project.id, name, body.length, contentType, key, user.id],
    );
    const people = await getUsers([user.id]);
    res.status(201).json({
      id: result.insertId,
      name,
      size: body.length,
      contentType,
      uploadedBy: userRef(user.id, people.get(user.id)),
      createdAt: new Date(),
      ...fileUrls(project.id, result.insertId),
    });
  }),
);

router.get(
  '/projects/:id/files/:fileId/raw',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireProjectMember(req.params.id, user.id);
    const [row] = await query<FileRow>(`SELECT ${FILE_COLUMNS} FROM project_file WHERE id = ? AND project_id = ? LIMIT 1`, [
      Number(req.params.fileId),
      Number(req.params.id),
    ]);
    if (!row) throw notFound('附件不存在');
    if (!storageConfigured()) throw new ApiError(503, 'STORAGE_UNAVAILABLE', '对象存储未配置');
    const download = String(req.query.mode || 'download') === 'download';
    let object;
    try {
      object = await getObject(row.object_key);
    } catch (error) {
      if (error instanceof StorageError) {
        throw new ApiError(error.status === 404 ? 404 : 502, 'STORAGE_ERROR', error.message);
      }
      throw error;
    }
    const filename = encodeURIComponent(row.name).replace(/['()*]/g, (c) =>
      `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    res.setHeader('Content-Type', row.content_type || object.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (object.contentLength != null) res.setHeader('Content-Length', String(object.contentLength));
    await pipeline(Readable.fromWeb(object.body as Parameters<typeof Readable.fromWeb>[0]), res);
  }),
);

router.delete(
  '/projects/:id/files/:fileId',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const project = await loadProject(req.params.id);
    if (!(await loadMembership(project.id, user.id))) throw forbidden('NOT_MEMBER', '只有项目成员可以删除附件');
    const [row] = await query<FileRow>(`SELECT ${FILE_COLUMNS} FROM project_file WHERE id = ? AND project_id = ? LIMIT 1`, [
      Number(req.params.fileId),
      project.id,
    ]);
    if (!row) throw notFound('附件不存在');
    if (row.uploaded_by !== user.id && project.leader_id !== user.id) {
      throw forbidden('NOT_ALLOWED', '只有上传者本人或项目 leader 可以删除附件');
    }
    if (storageConfigured()) {
      try {
        await deleteObject(row.object_key);
      } catch (error) {
        // 删对象失败不阻塞元数据清理；留日志给运维补删。
        console.error('[files] 删除对象失败', error instanceof Error ? error.message : String(error));
      }
    }
    await execute('DELETE FROM project_file WHERE id = ?', [row.id]);
    res.json({ ok: true });
  }),
);

export default router;
