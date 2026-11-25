// 开发者档案：只存在本站的 user_profile 里（姓名/头像/邮箱仍以 UniSSO 目录为准）。
// 年级、技能、GitHub、自我介绍是“展示资料”，不参与任何鉴权。

import { Router } from 'express';
import { execute, one } from '../db.ts';
import { badRequest, unauthorized, wrap } from '../http.ts';

const router = Router();

interface ProfileRow {
  user_id: string;
  name: string | null;
  avatar: string | null;
  email: string | null;
  skills: unknown;
  github: string | null;
  grade: string | null;
  bio: string | null;
}

function skillsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => String(item)).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
    } catch {
      /* 坏数据按空处理 */
    }
  }
  return [];
}

function cleanSkills(raw: unknown): string[] {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const out: string[] = [];
  for (const item of list) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    if (value.length > 24) throw badRequest('BAD_SKILL', '单个技能不超过 24 字');
    if (!out.includes(value)) out.push(value);
  }
  if (out.length > 8) throw badRequest('TOO_MANY_SKILLS', '技能最多 8 个');
  return out;
}

function cleanText(raw: unknown, max: number, code: string, message: string): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (value.length > max) throw badRequest(code, message);
  return value || null;
}

router.get(
  '/me/profile',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw unauthorized();
    const row = await one<ProfileRow>(
      'SELECT user_id, name, avatar, email, skills, github, grade, bio FROM user_profile WHERE user_id = ?',
      [user.id],
    );
    res.json({
      id: user.id,
      name: row?.name ?? user.name ?? null,
      avatar: row?.avatar ?? user.avatar ?? null,
      email: row?.email ?? user.email ?? null,
      skills: skillsOf(row?.skills),
      github: row?.github ?? null,
      grade: row?.grade ?? null,
      bio: row?.bio ?? null,
    });
  }),
);

router.patch(
  '/me/profile',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw unauthorized();
    const body = req.body ?? {};
    const skills = body.skills !== undefined ? cleanSkills(body.skills) : undefined;
    const github = body.github !== undefined ? cleanText(body.github, 128, 'BAD_GITHUB', 'GitHub 链接过长') : undefined;
    const grade = body.grade !== undefined ? cleanText(body.grade, 32, 'BAD_GRADE', '年级不超过 32 字') : undefined;
    const bio = body.bio !== undefined ? cleanText(body.bio, 2000, 'BAD_BIO', '自我介绍不超过 2000 字') : undefined;
    if ([skills, github, grade, bio].every((value) => value === undefined)) {
      throw badRequest('NOTHING_TO_UPDATE', '没有可更新的字段');
    }
    // 只更新档案列；name/avatar/email 由登录回调维护，这里不碰。
    await execute(
      `INSERT INTO user_profile (user_id, skills, github, grade, bio) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         skills = COALESCE(VALUES(skills), skills),
         github = COALESCE(VALUES(github), github),
         grade = COALESCE(VALUES(grade), grade),
         bio = COALESCE(VALUES(bio), bio)`,
      [
        user.id,
        skills === undefined ? null : JSON.stringify(skills),
        github === undefined ? null : github,
        grade === undefined ? null : grade,
        bio === undefined ? null : bio,
      ],
    );
    const row = await one<ProfileRow>(
      'SELECT user_id, name, avatar, email, skills, github, grade, bio FROM user_profile WHERE user_id = ?',
      [user.id],
    );
    res.json({
      ok: true,
      profile: {
        id: user.id,
        skills: skillsOf(row?.skills),
        github: row?.github ?? null,
        grade: row?.grade ?? null,
        bio: row?.bio ?? null,
      },
    });
  }),
);

export default router;
