// 「上手」内容：从仓库 docs/guide/*.md 读取，按文件名排序返回。
// 内容随代码走（PR 评审），站点只读渲染；改文档不需要改代码。

import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { notFound, wrap } from '../http.ts';

const router = Router();

const GUIDE_DIR = process.env.GUIDE_DIR || path.resolve(process.cwd(), '../docs/guide');

interface GuideDoc {
  slug: string;
  title: string;
  summary: string;
  minutes: number | null;
  content: string;
}

function parseDoc(slug: string, raw: string): GuideDoc {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let title = slug;
  let summary = '';
  let minutes: number | null = null;
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    if (!line) continue;
    if (line.startsWith('# ')) {
      title = line.slice(2).trim();
      index += 1;
      break;
    }
    break;
  }
  // 标题之后、正文之前的连续 “> …” 是摘要区。
  for (; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    if (!line.startsWith('>')) break;
    const text = line.slice(1).trim();
    const match = text.match(/预计阅读[：:]\s*(\d+)\s*分钟/);
    if (match) minutes = Number(match[1]);
    else if (!summary) summary = text;
  }
  return { slug, title, summary, minutes, content: lines.slice(index).join('\n').trim() };
}

router.get(
  '/guide',
  wrap(async (_req, res) => {
    let files: string[];
    try {
      files = (await fs.readdir(GUIDE_DIR)).filter((name) => name.endsWith('.md')).sort();
    } catch {
      res.json({ items: [] });
      return;
    }
    const items: GuideDoc[] = [];
    for (const file of files) {
      const raw = await fs.readFile(path.join(GUIDE_DIR, file), 'utf8').catch(() => '');
      if (!raw) continue;
      items.push(parseDoc(file.replace(/\.md$/, ''), raw));
    }
    res.json({ items });
  }),
);

router.get(
  '/guide/:slug',
  wrap(async (req, res) => {
    const slug = String(req.params.slug || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!slug) throw notFound('文档不存在');
    const raw = await fs.readFile(path.join(GUIDE_DIR, `${slug}.md`), 'utf8').catch(() => null);
    if (!raw) throw notFound('文档不存在');
    res.json(parseDoc(slug, raw));
  }),
);

export default router;
