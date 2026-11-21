import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { formatTime } from './api';
import type { ApplyStatus, ApplyType, DemandStatus, Role } from './types';

export type Tone = 'gray' | 'amber' | 'green' | 'red' | 'blue';
export type NoticeTone = 'info' | 'success' | 'error';

export interface StatusMeta {
  label: string;
  tone: Tone;
}

export const APPLY_STATUS: Record<ApplyStatus, StatusMeta> = {
  waiting: { label: '等待中', tone: 'amber' },
  accepted: { label: '已通过', tone: 'green' },
  rejected: { label: '已拒绝', tone: 'red' },
};

export const DEMAND_STATUS: Record<DemandStatus, StatusMeta> = {
  waiting: { label: '待接单', tone: 'gray' },
  accepted: { label: '进行中', tone: 'blue' },
  review: { label: '待确认', tone: 'amber' },
  completed: { label: '已完成', tone: 'green' },
  suspended: { label: '挂起', tone: 'gray' },
};

export const ROLE: Record<Role, StatusMeta> = {
  leader: { label: 'Leader', tone: 'blue' },
  participant: { label: '成员', tone: 'gray' },
};

export const APPLY_TYPE: Record<ApplyType, StatusMeta> = {
  leader: { label: '申请当 Leader', tone: 'blue' },
  participant: { label: '申请加入', tone: 'gray' },
};

// 用户实体在 UniSSO；目录里查不到的人只剩一个 id，统一显示为「未知用户」，不编造名字。
export const UNKNOWN_USER = '未知用户';

export interface NamedUser {
  name?: string | null;
  username?: string | null;
}

export function displayName(user: NamedUser | null | undefined): string {
  if (!user) return UNKNOWN_USER;
  return user.name || user.username || UNKNOWN_USER;
}

interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

export function Avatar({ name, src, size }: AvatarProps) {
  let cls = 'avatar';
  if (size === 'lg') cls = 'avatar avatar--lg';
  else if (size === 'md') cls = 'avatar avatar--md';
  // 目录不可用时名字是 null：这里必须容错，否则整页渲染会抛错变空白。
  const initial = String(name ?? '').trim().slice(0, 1).toUpperCase() || '?';
  return (
    <span className={cls} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initial}
    </span>
  );
}

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = 'gray', children }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

interface StatusBadgeProps {
  map: Record<string, StatusMeta>;
  value: string | null | undefined;
}

export function StatusBadge({ map, value }: StatusBadgeProps) {
  const meta = (value == null ? undefined : map[value]) || { label: value ?? '', tone: 'gray' as Tone };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function TimeAgo({ value }: { value?: string | null }) {
  if (!value) return <span className="faint">—</span>;
  return (
    <span className="faint" title={new Date(value).toLocaleString('zh-CN')}>
      {formatTime(value)}
    </span>
  );
}

interface ModalProps {
  open: boolean;
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, title, sub, onClose, children, footer, wide }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={wide ? 'modal modal--wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {sub ? <p className="modal__sub">{sub}</p> : null}
        {children}
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="faint">{hint}</span> : null}
    </div>
  );
}

interface EmptyProps {
  title?: string;
  hint?: ReactNode;
}

export function Empty({ title = '暂无数据', hint }: EmptyProps) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint || '换个筛选条件试试。'}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton-row" key={index} />
      ))}
    </div>
  );
}

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}

export function Pager({ page, pageSize, total, onPage }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="pager">
      <span>
        共 {total} 条 · 第 {page} / {pages} 页
      </span>
      <div className="pager__btns">
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          上一页
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  );
}

export interface ToastValue {
  push: (message: string, tone?: NoticeTone) => void;
}

interface ToastItem {
  id: string;
  message: string;
  tone: NoticeTone;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: NoticeTone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 3200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack">
        {items.map((item) => (
          <div key={item.id} className={`notice notice-${item.tone} toast`}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}
