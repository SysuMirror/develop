import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api, messageOf } from './api';
import type { ProjectFile } from './types';
import { TimeAgo, displayName, useToast } from './ui';

interface FilesPayload {
  storage: string;
  maxFileBytes: number;
  items: ProjectFile[];
}

const FALLBACK_MAX = 20 * 1024 * 1024;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function previewable(contentType: string | null): boolean {
  if (!contentType) return false;
  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('text/') ||
    contentType === 'application/pdf' ||
    contentType === 'application/json'
  );
}

interface Props {
  projectId: number;
  /** 只有上传者本人或 leader 能删。 */
  canDelete: (file: ProjectFile) => boolean;
}

/**
 * 开发说明的附件区：字节存集市云对象存储，页面只做列表、上传、预览与下载。
 * 非成员看不到这个组件；列表接口也会再校验一次成员身份。
 */
export function ProjectFilesSection({ projectId, canDelete }: Props) {
  const { push } = useToast();
  const [data, setData] = useState<FilesPayload | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<FilesPayload>(`/projects/${projectId}/files`));
      setError('');
    } catch (err) {
      setError(messageOf(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const limit = data?.maxFileBytes ?? FALLBACK_MAX;
    setUploading(true);
    for (const file of files) {
      if (file.size > limit) {
        push(`${file.name} 超过 ${humanSize(limit)}，已跳过`, 'error');
        continue;
      }
      try {
        await api.upload(`/projects/${projectId}/files?name=${encodeURIComponent(file.name)}`, file);
      } catch (err) {
        push(`${file.name}：${messageOf(err)}`, 'error');
      }
    }
    setUploading(false);
    void load();
  }

  async function remove(file: ProjectFile) {
    if (!window.confirm(`删除附件「${file.name}」？`)) return;
    try {
      await api.del(`/projects/${projectId}/files/${file.id}`);
      push('已删除附件', 'success');
      void load();
    } catch (err) {
      push(messageOf(err), 'error');
    }
  }

  const items = data?.items ?? [];
  return (
    <div>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input ref={inputRef} type="file" multiple style={{ display: 'none' }} onChange={(event) => void pick(event)} />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={uploading || data?.storage === 'unavailable'}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? '上传中…' : '上传附件'}
        </button>
        <span className="faint">单个不超过 {humanSize(data?.maxFileBytes ?? FALLBACK_MAX)}，存集市云对象存储</span>
      </div>
      {data?.storage === 'unavailable' ? (
        <div className="notice notice-info">对象存储未配置，暂时只能查看已有附件。</div>
      ) : null}
      {error ? <div className="notice notice-error">{error}</div> : null}
      {items.length === 0 ? (
        <p className="faint" style={{ margin: 0 }}>
          还没有附件。设计稿、接口文档、部署说明都可以放这里。
        </p>
      ) : (
        <div className="list">
          {items.map((file) => (
            <div className="list__row" key={file.id}>
              <div className="grow">
                <span className="truncate">{file.name}</span>
                <div className="faint">
                  {humanSize(file.size)} · {displayName(file.uploadedBy)} · <TimeAgo value={file.createdAt} />
                </div>
              </div>
              {previewable(file.contentType) ? (
                <a className="btn-link" href={file.previewUrl} target="_blank" rel="noreferrer">
                  预览
                </a>
              ) : null}
              <a className="btn-link" href={file.downloadUrl}>
                下载
              </a>
              {canDelete(file) ? (
                <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => void remove(file)}>
                  删除
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
