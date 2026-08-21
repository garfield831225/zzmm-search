#!/bin/bash
# 8-21 11:26: NAS zzmm-search 安全部署脚本 (flock 互斥 + 完整部署)
# 用法: ssh NAS 'bash /tmp/zzm-deploy-safe.sh [tar-on-nas]'
#   tar-on-nas: NAS 上 tar 路径 (默认 /tmp/zzmm-build.tar.gz)

set -e

TAR_PATH="${1:-/tmp/zzmm-build.tar.gz}"
LOCK=/data_s001/deploy.lock
ROOT=/data_s001/docker/zzmm-search
STANDALONE=$ROOT/.next/standalone
TIMEOUT=900  # 15 分钟 hard timeout

echo "=== zzmm-search deploy (flock safe) ==="
echo "tar: $TAR_PATH"
echo "lock: $LOCK"
echo "PID: $$"
date

# Acquire lock (auto-release on exit, including timeout)
exec 200>$LOCK
if ! flock -n 200; then
  echo ""
  echo "[ABORT] Another deploy in progress. Lock held."
  echo "If stale (>${TIMEOUT}s), manually: sudo rm $LOCK"
  exit 1
fi
echo "[OK] Lock acquired"

# 15 min hard timeout (kill all child processes)
trap "echo '[TIMEOUT] $TIMEOUT s reached, killing'; pkill -P $$ 2>/dev/null; sleep 1" ALRM
( sleep $TIMEOUT && kill -ALRM $$ ) &

# Verify tar exists
if [ ! -f "$TAR_PATH" ]; then
  echo "[ABORT] tar not found: $TAR_PATH"
  exit 1
fi
TAR_SIZE=$(stat -c %s "$TAR_PATH")
echo "[OK] tar size: $TAR_SIZE bytes"

# 1) stop systemd
echo ""
echo "=== 1) stop systemd ==="
sudo -A systemctl stop zzmm-search.service 2>&1 || true
sleep 2

# 2) backup current + delete
echo ""
echo "=== 2) backup + delete standalone ==="
TS=$(date +%s)
if [ -d "$STANDALONE" ]; then
  if [ -f "$STANDALONE/.next/BUILD_ID" ]; then
    CUR_BID=$(cat "$STANDALONE/.next/BUILD_ID")
    echo "current BUILD_ID: $CUR_BID"
  fi
  sudo -A mv "$STANDALONE" "$ROOT/.next/standalone.bak.$TS" 2>&1 || true
  echo "backup: $ROOT/.next/standalone.bak.$TS"
fi
sudo -A rm -rf "$STANDALONE"
sudo -A mkdir -p "$STANDALONE"

# 3) untar
echo ""
echo "=== 3) untar ==="
cd "$STANDALONE"
sudo -A tar -xzf "$TAR_PATH" 2>&1 | tail -3
echo "extract done"
NEW_BID=$(cat "$STANDALONE/.next/BUILD_ID" 2>/dev/null || echo MISSING)
echo "new BUILD_ID: $NEW_BID"

# 4) cp static + public + env
echo ""
echo "=== 4) cp static + public + env ==="
if [ -d "$ROOT/.next/static" ]; then
  sudo -A cp -a "$ROOT/.next/static" "$STANDALONE/.next/" && echo "static copied"
fi
if [ -d "$ROOT/public" ]; then
  sudo -A mkdir -p "$STANDALONE/public"
  sudo -A cp -a "$ROOT/public/." "$STANDALONE/public/" && echo "public copied"
fi
if [ -f "$ROOT/.env.production" ]; then
  sudo -A cp -a "$ROOT/.env.production" "$STANDALONE/.env.production"
  sudo -A chown root:root "$STANDALONE/.env.production"
  sudo -A chmod 644 "$STANDALONE/.env.production"
  echo "env copied"
fi

# 5) start
echo ""
echo "=== 5) start ==="
sudo -A systemctl start zzmm-search.service 2>&1 || true
sleep 5
STATUS=$(sudo -A systemctl is-active zzmm-search.service 2>&1)
echo "systemd: $STATUS"

# 6) verify
echo ""
echo "=== 6) verify ==="
sleep 2
sudo -A curl -sS -o /dev/null -w "/: HTTP=%{http_code} SIZE=%{size_download}b\n" http://127.0.0.1:3004/ -A "Mozilla/5.0" 2>&1

echo ""
echo "=== done ==="
date
# Lock auto-released on exit
