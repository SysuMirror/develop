#!/usr/bin/env bash
# sseinfra 部署入口：监听 0.0.0.0:$PORT，前台常驻
set -euo pipefail

PORT="${PORT:-8080}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

DATA_DIR="${SDPY_DATA_DIR:-${DATA_DIR:-$ROOT/data}}"
mkdir -p "$DATA_DIR"
export DATA_DIR
export PORT

# —— 运行时密钥：持久盘上的 develop.env（600，不入仓库、不随 pod 重建丢失）——
# 内容：MYSQL_HOST/PORT/USER/PASSWORD/DB、SSO_ISSUER/CLIENT_ID/CLIENT_SECRET/REDIRECT_URI/SCOPE、DEV_LOGIN
# 平台注入的同名环境变量优先；这里只补缺。
SECRETS_FILE="${DATA_DIR}/develop.env"
if [ -f "$SECRETS_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in ''|\#*) continue ;; esac
    if [ -z "${!key:-}" ]; then export "$key=$value"; fi
  done < "$SECRETS_FILE"
  echo "[deploy] secrets: $SECRETS_FILE（已补缺 MYSQL_*/SSO_*）"
else
  echo "[deploy] WARN: $SECRETS_FILE 不存在，MySQL 与 UniSSO 可能不可用" >&2
fi

# 配好 UniSSO 后生产默认关闭演示登录；本地/无凭据场景不受影响
if [ -n "${SSO_CLIENT_ID:-}" ]; then
  export DEV_LOGIN="${DEV_LOGIN:-0}"
fi

# 构建阶段禁止 production，否则 npm 跳过 devDependencies（tsc/vite）
# 若平台注入了 NODE_ENV=production，这里先清掉
unset NODE_ENV || true

# --- runtime baseline: image node18 cannot run this ESM build; pin shared node22 ---
NODE_BIN=/shared/opt/node/22.23.3/bin/node
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node)"
export PATH="$(dirname "$NODE_BIN"):$PATH"
# npm via mirror (direct npmjs is blocked by the egress proxy with 407)
export NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"

# develop 平台：站点主域 develop.ssemarket.cn（模块 API 与站点同源，不再使用 developer-api 子域）
export PUBLIC_BASE="${PUBLIC_BASE:-${SDPY_PUBLIC_URL:-https://develop.ssemarket.cn}}"
export SSEAPI_API_PUBLIC_URL="${SSEAPI_API_PUBLIC_URL:-${SDPY_API_PUBLIC_URL:-https://develop.ssemarket.cn}}"
export SSEAPI_CORS_ORIGINS="${SSEAPI_CORS_ORIGINS:-https://develop.ssemarket.cn,http://localhost:5173}"
export PLATFORM_ADMIN_OAUTH_IDS="${PLATFORM_ADMIN_OAUTH_IDS:-327}"
# 敏感值（JWT_SECRET / SSEAPI_OAUTH_APP_SECRET / IMAGEBED_TOKEN / PLATFORM_SM2_*）
# 一律由部署平台注入，不在代码/包内提供默认值，避免密钥落仓库。
if [ -z "${JWT_SECRET:-}" ]; then
  echo "[deploy] FATAL: JWT_SECRET 未注入（请在部署平台环境变量中配置）" >&2
  exit 1
fi

# 集市 OAuth 为历史变量（新 develop 只认 UniSSO），保留兼容旧面板注入，不再强制要求
export SSEAPI_OAUTH_BASE_URL="${SSEAPI_OAUTH_BASE_URL:-https://ssemarket.cn/new}"
export SSEAPI_OAUTH_API_BASE_URL="${SSEAPI_OAUTH_API_BASE_URL:-https://ssemarket.cn}"
export SSEAPI_OAUTH_APP_ID="${SSEAPI_OAUTH_APP_ID:-${OAUTH_APP_ID:-sse-developer}}"
export SSEAPI_OAUTH_APP_SECRET="${SSEAPI_OAUTH_APP_SECRET:-${OAUTH_APP_SECRET:-}}"
export SSEAPI_OAUTH_REDIRECT_URI="${SSEAPI_OAUTH_REDIRECT_URI:-${OAUTH_REDIRECT_URI:-https://develop.ssemarket.cn/oauth/callback}}"
export SSEAPI_OAUTH_AUTHORIZE_PATH="${SSEAPI_OAUTH_AUTHORIZE_PATH:-/connect}"
export SSEAPI_OAUTH_SCOPE="${SSEAPI_OAUTH_SCOPE:-read_basic}"

echo "[deploy] PORT=$PORT DATA_DIR=$DATA_DIR"
echo "[deploy] PUBLIC_BASE=$PUBLIC_BASE"
echo "[deploy] unisso=${SSO_ISSUER:-未配置} client=${SSO_CLIENT_ID:-未配置} dev_login=${DEV_LOGIN:-<unset>}"
echo "[deploy] mysql=${MYSQL_HOST:-未配置}/${MYSQL_DB:-未配置} user=${MYSQL_USER:+已配置}"
if [ -n "${MINIO_ENDPOINT:-}" ] && [ -n "${MINIO_BUCKET:-}" ]; then
  echo "[deploy] store=minio:${MINIO_BUCKET} (local backup under DATA_DIR)"
else
  echo "[deploy] store=local (未注入 MINIO_*，仅写 DATA_DIR)"
fi

# 若包内有 server/.env，补缺（不覆盖已 export / 平台注入的键）
if [ -f "$ROOT/server/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/server/.env" || true
  set +a
fi
npm_ci_or_install() {
  # 强制带上 devDependencies，避免 NODE_ENV/omit=dev 干扰
  if [ -f package-lock.json ]; then
    npm ci --include=dev
  else
    npm install --include=dev
  fi
}

# dist 缺失、或任一源码/配置比 dist 新 → 需要重新构建。
# 这样“push 后自动部署”就能真正把新代码编译进产物，而不是只重启旧 dist。
is_stale() {
  local marker="$1"; shift
  [ ! -f "$marker" ] && return 0
  local path
  for path in "$@"; do
    [ -e "$path" ] || continue
    if [ -n "$(find "$path" -newer "$marker" -print -quit 2>/dev/null)" ]; then
      return 0
    fi
  done
  return 1
}

# —— server ——
if [ -f server/package.json ]; then
  cd server
  if is_stale dist/index.js src package.json package-lock.json tsconfig.json; then
    echo "[deploy] server 源码有更新，重新编译…"
    npm_ci_or_install >/dev/null 2>&1 || npm install --include=dev >/dev/null 2>&1 || true
    if [ ! -f node_modules/typescript/bin/tsc ]; then
      npm install --no-save --no-audit --no-fund typescript@5.9.3 @types/node@22 @types/express@4 >/dev/null 2>&1 || true
    fi
    rm -rf dist.new
    if [ -f node_modules/typescript/bin/tsc ] \
       && node node_modules/typescript/bin/tsc -p tsconfig.json --outDir dist.new \
       && cp src/schema.sql dist.new/schema.sql; then
      rm -rf dist.old
      mv dist dist.old 2>/dev/null || true
      mv dist.new dist
      rm -rf dist.old
      echo "[deploy] server 编译完成"
    else
      rm -rf dist.new
      echo "[deploy] WARN: server 编译失败，继续使用旧 dist（服务不中断）" >&2
    fi
  else
    echo "[deploy] server 无需重新编译"
  fi
  if [ ! -f dist/index.js ]; then
    echo "[deploy] FATAL: server/dist/index.js 不存在且无法编译" >&2
    exit 1
  fi
  npm ci --omit=dev 2>/dev/null || npm install --omit=dev 2>/dev/null || true
  cd "$ROOT"
  echo "[deploy] server OK: server/dist/index.js"
fi

# —— web ——
if [ -f web/package.json ]; then
  export VITE_BASE_PATH="/"
  export VITE_API_BASE=""
  cd web
  if is_stale dist/index.html src package.json package-lock.json tsconfig.json vite.config.ts index.html; then
    echo "[deploy] web 源码有更新，重新构建…"
    npm_ci_or_install >/dev/null 2>&1 || npm install --include=dev >/dev/null 2>&1 || true
    rm -rf dist.new
    if [ -f node_modules/vite/bin/vite.js ] \
       && VITE_BASE_PATH=/ VITE_API_BASE= node node_modules/vite/bin/vite.js build --outDir dist.new --emptyOutDir >/dev/null 2>&1; then
      rm -rf dist.old
      mv dist dist.old 2>/dev/null || true
      mv dist.new dist
      rm -rf dist.old
      echo "[deploy] web 构建完成"
    else
      rm -rf dist.new
      echo "[deploy] WARN: web 构建失败，继续使用旧 dist" >&2
    fi
  else
    echo "[deploy] web 无需重新构建"
  fi
  cd "$ROOT"
  if [ ! -f web/dist/index.html ]; then
    echo "[deploy] FATAL: web/dist/index.html 不存在" >&2
    exit 1
  fi
  echo "[deploy] web OK: web/dist/index.html"
fi

export SSEAPI_FRONTEND_DIST="${SSEAPI_FRONTEND_DIST:-$ROOT/web/dist}"

export NODE_ENV=production
cd server
# 迁移随部署自动执行（幂等）；失败只告警，不阻塞启动（旧表仍可服务）。
if [ -f dist/migrate.js ]; then
  "$NODE_BIN" dist/migrate.js || echo "[deploy] WARN: 数据库迁移失败，请手动检查" >&2
fi
echo "[deploy] starting node dist/index.js"
exec "$NODE_BIN" dist/index.js
