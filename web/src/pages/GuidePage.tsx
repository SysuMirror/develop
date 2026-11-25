import { useEffect, useState } from 'react';
import { useApi } from '../hooks';
import { MarkdownText } from '../markdown';
import { Skeleton } from '../ui';
import type { GuideDoc } from '../types';

export default function GuidePage() {
  const { data, loading, error } = useApi<{ items: GuideDoc[] }>('/guide');
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    const first = data?.items[0];
    if (!slug && first) setSlug(first.slug);
  }, [slug, data]);

  if (loading) {
    return (
      <div>
        <Skeleton rows={6} />
      </div>
    );
  }

  if (error) {
    return <div className="notice notice-error">{error.message}</div>;
  }

  const items = data?.items ?? [];
  const first = items[0];
  if (!first) {
    return <div className="notice notice-info">还没有上手文档。</div>;
  }

  const current = items.find((item) => item.slug === slug) ?? first;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">上手</h1>
          <p className="page-sub">新人先读这三篇：环境、分支提交、需求流程。内容随仓库走，改文档走 PR。</p>
        </div>
      </div>

      <div className="guide-layout">
        <nav className="panel guide-nav" aria-label="上手目录">
          {items.map((item) => (
            <button
              type="button"
              key={item.slug}
              className={`guide-nav__item${item.slug === current.slug ? ' active' : ''}`}
              onClick={() => setSlug(item.slug)}
            >
              <span className="guide-nav__title">{item.title}</span>
              <span className="faint guide-nav__meta">
                {item.minutes ? `${item.minutes} 分钟` : ''}
              </span>
            </button>
          ))}
        </nav>

        <article className="panel guide-content">
          <h2 className="guide-content__title">{current.title}</h2>
          {current.summary ? <p className="page-sub">{current.summary}</p> : null}
          <MarkdownText source={current.content} />
        </article>
      </div>
    </div>
  );
}
