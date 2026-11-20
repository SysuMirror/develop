import { useState } from 'react';
import { api, messageOf } from './api';
import { useToast } from './ui';
import type { DemandItem } from './types';

interface DemandAction {
  label: string;
  path: string;
  done: string;
  variant: 'btn-primary' | 'btn-secondary';
  confirm?: string;
}

// 动作集合全部来自服务端的 permissions，前端只负责按钮文案和顺序。
function actionsOf(demand: DemandItem): DemandAction[] {
  const p = demand.permissions;
  const base = `/demands/${demand.id}`;
  const list: DemandAction[] = [];
  if (p.canAccept) list.push({ label: '接单', path: `${base}/accept`, done: '已接单', variant: 'btn-primary' });
  if (p.canSubmit) {
    list.push({ label: '提交完成', path: `${base}/submit`, done: '已提交，等待发布者确认', variant: 'btn-primary' });
  }
  if (p.canReview) {
    list.push({ label: '确认完成', path: `${base}/confirm`, done: '已验收，需求完成', variant: 'btn-primary' });
    list.push({
      label: '驳回',
      path: `${base}/reject`,
      done: '已驳回，退回进行中',
      variant: 'btn-secondary',
      confirm: '驳回后需求回到进行中，接单人需要重新提交。确定驳回？',
    });
  }
  if (p.canSuspend) {
    list.push({
      label: '挂起',
      path: `${base}/suspend`,
      done: '需求已挂起',
      variant: 'btn-secondary',
      confirm: '挂起后需求暂停流转，可随时恢复。确定挂起？',
    });
  }
  if (p.canResume) list.push({ label: '恢复', path: `${base}/resume`, done: '需求已恢复', variant: 'btn-secondary' });
  return list;
}

export function DemandActions({
  demand,
  onChanged,
  empty = '—',
}: {
  demand: DemandItem;
  onChanged: () => void;
  empty?: string | null;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const actions = actionsOf(demand);

  if (actions.length === 0) return empty ? <span className="faint">{empty}</span> : null;

  async function run(action: DemandAction) {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setBusy(true);
    try {
      await api.post(action.path);
      push(action.done, 'success');
      onChanged();
    } catch (error) {
      push(messageOf(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      {actions.map((action) => (
        <button
          key={action.path}
          type="button"
          className={`btn ${action.variant} btn-sm`}
          disabled={busy}
          onClick={() => run(action)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
