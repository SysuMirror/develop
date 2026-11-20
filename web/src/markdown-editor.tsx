import type { ReactNode } from 'react';
import { MarkdownText } from './markdown';

interface MarkdownEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** 正文为空时右侧预览的占位文案。 */
  previewEmpty?: string;
  placeholder?: string;
  /** 左侧文本域上方的标题，默认「内容（Markdown）」。 */
  label?: string;
  /** 文本域下方的提示，默认给快捷键与语法说明。 */
  hint?: ReactNode;
  /** 文本域里按 Ctrl / ⌘ + Enter 时触发，通常是「保存」。 */
  onSubmitShortcut?: () => void;
}

/**
 * 左写右预览的 Markdown 编辑器。表单页共用，样式在 styles.css 的 .editor 一节。
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  previewEmpty = '在左侧写点什么，这里会实时渲染。',
  placeholder,
  label = '内容（Markdown）',
  hint = '支持 Markdown（标题、列表、代码块、表格、链接）；Ctrl / ⌘ + Enter 保存。',
  onSubmitShortcut,
}: MarkdownEditorProps) {
  return (
    <div className="editor">
      <div className="editor__pane">
        <label className="editor__label" htmlFor={id}>
          {label}
        </label>
        <textarea
          id={id}
          className="textarea editor__textarea"
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              onSubmitShortcut?.();
            }
          }}
        />
        <p className="faint">{hint}</p>
      </div>
      <div className="editor__pane">
        <span className="editor__label">预览</span>
        <div className="panel editor__preview">
          <MarkdownText source={value} empty={previewEmpty} />
        </div>
      </div>
    </div>
  );
}
