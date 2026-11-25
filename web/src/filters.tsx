import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './ui';

/**
 * 列表页共用的一组筛选控件。
 *
 * 约定：一页只有一个搜索框；其余条件用分段控件或下拉，统一放在 FilterBar 里。
 * 桌面端一行排开，移动端把「次要条件」收进底部抽屉（Modal 在窄屏就是抽屉）。
 */

export interface Option {
  value: string;
  label: string;
}

interface SegmentedProps {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}

/** 分段控件：一条轨道里的单选，用于「全部 / 我负责的 / 我参与的」这类主筛选。 */
export function Segmented({ label, value, options, onChange }: SegmentedProps) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value || 'all'}
          type="button"
          className={option.value === value ? 'segmented__item segmented__item--on' : 'segmented__item'}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}

export function SearchField({ value, onChange, placeholder, label }: SearchFieldProps) {
  return (
    <div className="searchfield">
      <SearchIcon />
      <input
        className="searchfield__input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
        }}
      />
      {value ? (
        <button type="button" className="searchfield__clear" aria-label="清除搜索" onClick={() => onChange('')}>
          <ClearIcon />
        </button>
      ) : null}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}

/** 紧凑下拉：外观与输入框一致，左侧文字是当前值，用作「状态 / 难度」这类次要筛选。 */
export function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="selectfield">
      <select
        id={id}
        className="selectfield__select"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value || 'any'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronIcon />
    </div>
  );
}

interface FilterBarProps {
  children: ReactNode;
  /** 右侧结果概要，例如「共 4 个项目」。 */
  summary?: ReactNode;
}

export function FilterBar({ children, summary }: FilterBarProps) {
  return (
    <div className="filterbar">
      <div className="filterbar__controls">{children}</div>
      {summary ? <span className="filterbar__summary">{summary}</span> : null}
    </div>
  );
}

interface MobileFiltersProps {
  open: boolean;
  onClose: () => void;
  onReset: () => void;
  /** 已启用的次要条件数量，用来在按钮上提示。 */
  activeCount: number;
  children: ReactNode;
}

/** 窄屏下的「筛选」抽屉：次要条件全部收在这里，列表上方只留搜索与主筛选。 */
export function MobileFilters({ open, onClose, onReset, activeCount, children }: MobileFiltersProps) {
  return (
    <Modal open={open} title="筛选" sub="选中后立即生效。" onClose={onClose}>
      <div className="filtersheet">{children}</div>
      <div className="filtersheet__foot">
        <button type="button" className="btn btn-ghost" onClick={onReset} disabled={activeCount === 0}>
          重置
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          完成
        </button>
      </div>
    </Modal>
  );
}

/** 抽屉里的单个条件：给下拉补一个可见的标题，桌面端不需要。 */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="filtersheet__field">
      <span className="filtersheet__label">{label}</span>
      {children}
    </label>
  );
}

/** 窄屏下打开筛选抽屉的按钮；有条件生效时用一个小圆点提示。 */
export function FilterToggle({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" className="filtertoggle" onClick={onClick} aria-label="打开筛选">
      <FilterIcon />
      筛选
      {count > 0 ? <span className="filtertoggle__count">{count}</span> : null}
    </button>
  );
}

/** 媒体查询 hook：只在 JS 需要决定渲染位置时使用，纯样式切换一律交给 CSS。 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function SearchIcon() {
  return (
    <svg className="searchfield__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.25" />
      <path d="m12.5 12.5 4 4" strokeLinecap="round" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="m7.8 7.8 4.4 4.4M12.2 7.8l-4.4 4.4" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="selectfield__chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="m6 8.5 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg className="filtertoggle__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M3.5 6h13M6 10h8M8.5 14h3" strokeLinecap="round" />
    </svg>
  );
}
