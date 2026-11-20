// 行级 diff：给需求修订历史用，只依赖 LCS，不引外部库。
// 输入两段纯文本（Markdown 源码），按行比较；输出保持原来的行序，前端照着渲染红绿高亮。
//
// 用例（web/src/diff.ts 的自测口径，改动算法时照着核一遍）：
//   diffLines('a\nb', 'a\nc') => [same a, del b, add c]
//   diffLines('', 'a')         => [add a]
//   diffLines('a', 'a')        => [same a]

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
  /** 旧版本里的行号（1 起），新增行为 null。 */
  oldLine: number | null;
  /** 新版本里的行号（1 起），删除行为 null。 */
  newLine: number | null;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
}

// 超过这个格子数（旧行数 × 新行数）就不做 LCS：O(n·m) 的表会把页面卡住，
// 需求正文这种文本量正常到不了，真到了说明是粘进来的巨长内容，整段替换更好看也更快。
const MAX_CELLS = 4_000_000;

function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

// 内容太长时不做 LCS：整段删除 + 整段新增，至少不会把页面卡住。
function wholeReplace(a: string[], b: string[]): DiffResult {
  return {
    lines: [
      ...a.map((text, index) => ({ type: 'del' as const, text, oldLine: index + 1, newLine: null })),
      ...b.map((text, index) => ({ type: 'add' as const, text, oldLine: null, newLine: index + 1 })),
    ],
    added: b.length,
    removed: a.length,
  };
}

// table[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度。
// noUncheckedIndexedAccess 打开着，越界读一律走 at() 回落到 0（边界外的 LCS 长度就是 0）。
function lcsTable(a: string[], b: string[]): (i: number, j: number) => number {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  const at = (i: number, j: number): number => table[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = table[i];
    if (!row) continue;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return at;
}

// 顺着 LCS 表贪心回溯：左边先删，右边先加，相同就记为未改动。
function walk(a: string[], b: string[], at: (i: number, j: number) => number): DiffResult {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i] ?? '';
    const right = b[j] ?? '';
    if (left === right) {
      lines.push({ type: 'same', text: left, oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      lines.push({ type: 'del', text: left, oldLine: i + 1, newLine: null });
      removed += 1;
      i += 1;
    } else {
      lines.push({ type: 'add', text: right, oldLine: null, newLine: j + 1 });
      added += 1;
      j += 1;
    }
  }
  for (; i < a.length; i += 1) {
    lines.push({ type: 'del', text: a[i] ?? '', oldLine: i + 1, newLine: null });
    removed += 1;
  }
  for (; j < b.length; j += 1) {
    lines.push({ type: 'add', text: b[j] ?? '', oldLine: null, newLine: j + 1 });
    added += 1;
  }
  return { lines, added, removed };
}

/** 只比较相邻两版正文；同一行文本相同即视为未改动。 */
export function diffLines(before: string | null | undefined, after: string | null | undefined): DiffResult {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length > MAX_CELLS) return wholeReplace(a, b);
  return walk(a, b, lcsTable(a, b));
}
