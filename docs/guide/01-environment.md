# 环境与账号

> 从零到本地跑起来：统一身份、开发者资格、代码拉取、常用工具。
> 预计阅读：5 分钟

## 1. 账号与资格

- 所有平台共用同一套 **SSE 统一身份**（UniSSO，sso.ssemarket.cn），邮箱 + 密码登录，不另设账号。
- **开发者资格**：登录一次 join.ssemarket.cn 就会自动开通，不需要审批。在 develop 里看到「前往集市完成认证」就是还没登录过 join。
- 账号出问题（改不了密码、邮箱不对）先找运营组，不要在平台里重复注册。

## 2. 拉代码

GitHub 仓库统一在 `github.com/SysuMirror` 下。两种方式都行：

```bash
# HTTPS（简单，需要 GitHub 账号有权限）
git clone https://github.com/SysuMirror/<repo>.git

# SSH（推荐，登录一次后不再问密码）
git clone git@github.com:SysuMirror/<repo>.git
```

SSH 需要先在 GitHub 账号里加本机的 `~/.ssh/id_ed25519.pub`。没有 key 时执行：

```bash
ssh-keygen -t ed25519 -C "你的邮箱"
cat ~/.ssh/id_ed25519.pub   # 复制到 GitHub → Settings → SSH keys
```

## 3. 本地跑 develop

develop 本身也是开源的（SysuMirror/develop），前后端同仓：

```bash
cd server && npm install
cp .env.example .env        # 填 MySQL / SSO（没有就开 DEV_LOGIN=1 用演示身份）
npm run dev                 # 后端 :8080

cd web && npm install
npm run dev                 # 前端 :5173，/api 已代理到 :8080
```

需要 MySQL 8。没有数据库时可以先用 `DEV_LOGIN=1` 看界面，业务接口仍需真实库。

## 4. 常用工具

| 用途 | 工具 |
|---|---|
| 编辑器 | VS Code（推荐装 ESLint / Prettier） |
| 接口调试 | curl / Bruno / Postman |
| Git 图形界面 | GitHub Desktop、Fork 任选 |
| 运行时 | Node.js 22（本仓库后端要求 22+） |

## 5. 遇到问题

- 登录后进 develop 被弹回 join：先在 join 登录一次，再回来刷新。
- 拉代码 443 超时：换 SSH（`git@github.com:SysuMirror/<repo>.git`）。
- 本地起不来：把报错贴到群里，附 `node -v`、`npm -v` 和完整错误。
