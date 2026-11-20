import { useEffect, useState } from 'react';
import { api, messageOf } from './api';
import { diffLines } from './diff';
import { TimeAgo, displayName } from './ui';
import type { UserRef } from './types';

// 服务端 /demands/:id/revisions 的一条：某次修改后的完整正文快照（revision 0 是发布时的原文）。
export interface DemandRevision {
  revision: number;
  title: string;
  detail: string | null;
  editor: UserRef;
  createdAt: string;
}

type LoadState = { items: DemandRevision[] | null; loading: boolean; error: string | null };

// 修改记录面板：点开才拉历史，默认选中最新一版，展示与上一版的行级 diff。
export function DemandRevisions({ demandId, revision }: { demandId: number; revision: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ items: null, loading: false, error: null });
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (!open || state.items) return;
    let alive = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api
      .get<{ items: DemandRevision[] }>(`/demands/${demandId}/revisions`)
      .then((data) => {
        if (!alive) return;
        setState({ items: data.items, loading: false, error: null });
        setSelected(data.items[0]?.revision ?? null);
      })
      .catch((error: unknown) => {
        if (alive) setState({ items: null, loading: false, error: messageOf(error) });
      });
    return () => {
      alive = false;
    };
  }, [open, demandId, state.items]);

  // 原文没改过就不占版面，标题旁的「已修改 N 次」已经说明一切。
  if (revision <= 0) return null;

  return (
    <div className="revisions">
      <div className="section-head">
        <h2>修改记录</h2>
        <button type="button" className="btn-link" onClick={() => setOpen((value) => !value)}>
          {open ? '收起' : `已修改 ${revision} 次，查看 diff`}
        </button>
      </div>

      {open ? (
        <div className="panel">
          {state.loading ? <div className="faint">正在加载修改记录…</div> : null}
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.items ? (
            <RevisionBody items={state.items} selected={selected} onSelect={setSelected} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RevisionBody({
  items,
  selected,
  onSelect,
}: {
  items: DemandRevision[];
  selected: number | null;
  onSelect: (revision: number) => void;
}) {
  const current = items.find((item) => item.revision === selected) ?? items[0];
  if (!current) return <div className="faint">还没有修改记录。</div>;
  const previous = items.find((item) => item.revision === current.revision - 1) ?? null;

  const titleDiff = diffLines(previous?.title ?? '', current.title);
  const detailDiff = diffLines(previous?.detail ?? '', current.detail ?? '');

  return (
    <div className="revisions__body">
      <ol className="revisions__list">
        {items.map((item) => (
          <li key={item.revision}>
            <button
              type="button"
              className={`revision-item${item.revision === current.revision ? ' revision-item--active' : ''}`}
              onClick={() => onSelect(item.revision)}
            >
              <span className="revision-item__no">{item.revision === 0 ? '原文' : `v${item.revision}`}</span>
              <span className="revision-item__meta">
                {displayName(item.editor)} · <TimeAgo value={item.createdAt} />
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="revisions__diff">
        <div className="revisions__caption">
          {current.revision === 0 ? (
            '发布时的原文'
          ) : (
            <>
              v{current.revision - 1} → v{current.revision}：标题{' '}
              <span className="faint">
                +{titleDiff.added} −{titleDiff.removed}
              </span>
              ，详情{' '}
              <span className="faint">
                +{detailDiff.added} −{detailDiff.removed}
              </span>
            </>
          )}
        </div>
        {titleDiff.added + titleDiff.removed > 0 ? (
          <DiffBlock label="标题" result={titleDiff} />
        ) : (
          <div className="faint revisions__unchanged">标题未改动</div>
        )}
        {detailDiff.added + detailDiff.removed > 0 ? (
          <DiffBlock label="详情" result={detailDiff} />
        ) : (
          <div className="faint revisions__unchanged">详情未改动</div>
        )}
      </div>
    </div>
  );
}

function DiffBlock({ label, result }: { label: string; result: ReturnType<typeof diffLines> }) {
  return (
    <div className="diff">
      <div className="diff__label">{label}</div>
      {result.lines.map((line, index) => (
        <div className={`diff-line diff-line--${line.type}`} key={index}>
          <span className="diff__no">{line.oldLine ?? ''}</span>
          <span className="diff__no">{line.newLine ?? ''}</span>
          <span className="diff__mark">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span>
          <span className="diff__text">{line.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}
