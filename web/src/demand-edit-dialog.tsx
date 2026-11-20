import { useState } from 'react';
import { api, messageOf } from './api';
import { Field, Modal, useToast } from './ui';
import type { DemandItem } from './types';

// 发布者修订标题与详情；验收开始后服务端会拒绝，入口由 permissions.canEdit 控制。
export function DemandEditDialog({
  demand,
  onClose,
  onSaved,
}: {
  demand: DemandItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { push } = useToast();
  const [form, setForm] = useState({ title: demand.title, detail: demand.detail ?? '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    const title = form.title.trim();
    if (!title) {
      push('请填写需求标题', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/demands/${demand.id}`, { title, detail: form.detail.trim() || null });
      push('需求已更新', 'success');
      onSaved();
      onClose();
    } catch (error) {
      push(messageOf(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="编辑需求"
      sub="已接单或待确认后改动会影响接单人，验收开始后即锁定。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            保存
          </button>
        </>
      }
    >
      <Field label="需求标题">
        <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      </Field>
      <Field label="需求详情" hint="支持 Markdown。">
        <textarea
          className="textarea"
          value={form.detail}
          onChange={(event) => setForm({ ...form, detail: event.target.value })}
        />
      </Field>
    </Modal>
  );
}
