import type { DirectoryUser } from './types.ts';

// 本地联调用的演示用户。
//
// 真实环境的用户来自 UniSSO（users 表），本平台不保存用户表；这里的 id 是固定写死的
// 假 sub，只在 DEV_LOGIN 与 SEED=1 两种本地场景下使用，生产不会出现。
export interface DemoUser {
  id: string;
  username: string;
  name: string;
  email: string;
  avatar: null;
}

export const DEMO_USERS: DemoUser[] = [
  { id: 'dev-1', username: 'chenxiao', name: '陈晓', email: 'chenxiao@example.com', avatar: null },
  { id: 'dev-2', username: 'lizhiyuan', name: '李知远', email: 'lizhiyuan@example.com', avatar: null },
  { id: 'dev-3', username: 'wangshuyi', name: '王书意', email: 'wangshuyi@example.com', avatar: null },
  { id: 'dev-4', username: 'zhaoming', name: '赵铭', email: 'zhaoming@example.com', avatar: null },
  { id: 'dev-5', username: 'sunke', name: '孙可', email: 'sunke@example.com', avatar: null },
  { id: 'dev-6', username: 'zhoucheng', name: '周澄', email: 'zhoucheng@example.com', avatar: null },
];

// 目录接口的字段形状，供 directory.ts 在 DEV_LOGIN 下复用。
export function demoDirectory(): DirectoryUser[] {
  return DEMO_USERS.map((user) => ({ ...user, developer: true, active: true }));
}
