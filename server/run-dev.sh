#!/bin/bash
# 本地/容器内启动后端；重复运行会先停掉旧进程。
set -e
cd /home/cloud/developer/server
pid=$(ss -ltnp 2>/dev/null | sed -n 's/.*:8080 .*pid=\([0-9]*\).*/\1/p' | head -1)
if [ -n "$pid" ]; then
  kill "$pid" 2>/dev/null || true
  sleep 0.5
fi
setsid node src/index.js >/tmp/api.log 2>&1 &
sleep 1.2
curl -s localhost:8080/api/health || tail -20 /tmp/api.log
echo
