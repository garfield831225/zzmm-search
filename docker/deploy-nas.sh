#!/bin/bash
# ============================================================
# zzmm-search 一键部署脚本 (极空间 Z4 Pro)
# 用法: ssh nas 然后跑 bash deploy-nas.sh
# ============================================================
set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$(dirname "$0")/.."
ROOT=$(pwd)

echo -e "${YELLOW}== zzmm-search deploy ==${NC}"
echo "工作目录: $ROOT"
echo

# ---- 1. 检查 .env.production ----
if [ ! -f .env.production ]; then
    echo -e "${RED}❌ 缺 .env.production${NC}"
    echo "复制 .env.production.example 后再跑"
    exit 1
fi
echo -e "${GREEN}✅ .env.production 存在${NC}"

# ---- 2. 检查 Docker ----
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker 未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker $(docker --version)${NC}"

if ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ docker compose 未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✅ docker compose $(docker compose version --short)${NC}"

# ---- 3. 拉最新代码 ----
if [ -d .git ]; then
    echo -e "${YELLOW}-- 拉最新代码 --${NC}"
    git pull --rebase --autostash || true
else
    echo -e "${YELLOW}-- 不是 git 仓库, 跳过 pull --${NC}"
fi

# ---- 4. 停旧容器 (如果存在) ----
if docker ps -a --format '{{.Names}}' | grep -qE 'zzmm-(nextjs|caddy)'; then
    echo -e "${YELLOW}-- 停旧容器 --${NC}"
    docker compose down --remove-orphans || true
fi

# ---- 5. 构建 + 启动 ----
echo -e "${YELLOW}-- 构建并启动 (首次 5-10 分钟) --${NC}"
docker compose build --pull
docker compose up -d

# ---- 6. 等待启动 ----
echo -e "${YELLOW}-- 等待 30 秒 --${NC}"
sleep 30

# ---- 7. 健康检查 ----
echo -e "${YELLOW}-- 健康检查 --${NC}"
if docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'zzmm-(nextjs|caddy)'; then
    echo -e "${GREEN}✅ 容器运行中${NC}"
else
    echo -e "${RED}❌ 容器未运行, 看日志:${NC}"
    docker compose logs --tail=50
    exit 1
fi

# ---- 8. 内部健康检查 ----
if docker exec zzmm-nextjs wget -q --spider http://localhost:3000/ 2>/dev/null; then
    echo -e "${GREEN}✅ Next.js 内部 200 OK${NC}"
else
    echo -e "${YELLOW}⚠️  Next.js 内部 200 失败, 看日志:${NC}"
    docker logs zzmm-nextjs --tail=30
fi

# ---- 9. Caddy SSL 检查 ----
echo -e "${YELLOW}-- Caddy SSL 状态 --${NC}"
docker logs zzmm-caddy --tail=20 | grep -E "certificate|https|listen" || true

# ---- 10. 完成 ----
echo
echo -e "${GREEN}== 部署完成 ==${NC}"
echo "本机: http://localhost:3000"
echo "公网: https://zzmm-search.uk  (等 Cloudflare SSL 配好 + DNS 生效 5-30 分钟)"
echo
echo "常用命令:"
echo "  docker compose ps              # 看状态"
echo "  docker compose logs -f         # 看实时日志"
echo "  docker compose logs nextjs     # 只看 Next.js 日志"
echo "  docker compose restart         # 重启"
echo "  docker compose down            # 停"
