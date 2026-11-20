import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReactNode } from 'react';

interface MarkdownTextProps {
  source?: string | null;
  empty?: ReactNode;
}

/**
 * 需求正文等长文本的 Markdown 渲染。
 *
 * 安全边界：不挂 rehype-raw，Markdown 里的裸 HTML 一律按文本丢弃；URL 交给 react-markdown 的
 * 默认 urlTransform，只有 http/https/mailto 与相对路径能成为 href，javascript: 之类会被清空。
 */
export function MarkdownText({ source, empty = '暂无正文。' }: MarkdownTextProps) {
  const text = (source ?? '').trim();
  if (!text) return <p className="faint">{empty}</p>;
  return (
    <div className="prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const external = /^https?:/i.test(href ?? '');
            return (
              <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
                {children}
              </a>
            );
          },
          table({ children }) {
            // 宽表在窄容器里横向滚动，不撑破面板。
            return (
              <div className="prose-table">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
