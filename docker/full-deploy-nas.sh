#!/bin/bash
# ============================================================
# zzmm-search 全量 NAS 部署脚本
# 用法: ssh 上去后跑 bash full-deploy-nas.sh
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ---- 配置 ----
REPO="https://github.com/garfield831225/zzmm-search.git"
APP_DIR="/volume1/docker/zzmm-search"

echo -e "${YELLOW}== zzmm-search NAS 全量部署 ==${NC}"
echo "时间: $(date)"
echo

# ---- 0. 检查 root/sudo ----
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}-- 提权到 root --${NC}"
    sudo -v
fi

# ---- 1. 安装 docker (如果没有) ----
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}-- 装 docker --${NC}"
    if command -v apt &> /dev/null; then
        sudo apt update && sudo apt install -y docker.io docker-compose-plugin
    elif command -v yum &> /dev/null; then
        sudo yum install -y docker docker-compose
    fi
    sudo systemctl enable --now docker
    sudo usermod -aG docker $USER
fi
echo -e "${GREEN}✅ docker $(docker --version)${NC}"

# ---- 2. 装 git (如果没有) ----
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}-- 装 git --${NC}"
    if command -v apt &> /dev/null; then
        sudo apt install -y git
    elif command -v yum &> /dev/null; then
        sudo yum install -y git
    fi
fi
echo -e "${GREEN}✅ git $(git --version)${NC}"

# ---- 3. 拉代码 ----
echo -e "${YELLOW}-- 拉代码 --${NC}"
sudo mkdir -p /volume1/docker
sudo chown $USER:$USER /volume1/docker
if [ ! -d "$APP_DIR" ]; then
    git clone $REPO $APP_DIR
else
    cd $APP_DIR
    git pull --rebase --autostash
fi
cd $APP_DIR
echo -e "${GREEN}✅ 代码在 $APP_DIR, 最新 commit: $(git log -1 --oneline)${NC}"

# ---- 4. 写 .env.production (从 example 拷, 然后填真实值) ----
if [ ! -f .env.production ]; then
    echo -e "${YELLOW}-- 写 .env.production (从用户拿 secret) --${NC}"
    cat > .env.production <<'EOF'
DATABASE_URL=postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
JWT_SECRET=5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606
JWT_EXPIRES_IN=7d
REDIS_HOST=host.docker.internal
REDIS_PORT=6379
REDIS_PASSWORD=
TMDB_API_KEY=7985342d5961e9ee3d5ef6d969c1b8dd
SITE_NAME=泽泽妈妈资源库
SITE_URL=https://zzmm-search.uk
ADMIN_EMAIL=admin@zzmm-search.uk
WECHAT_CONTACT=HKmaipanren
EOF
    chmod 600 .env.production
    echo -e "${GREEN}✅ .env.production 写好 (chmod 600)${NC}"
else
    echo -e "${GREEN}✅ .env.production 已存在, 跳过${NC}"
fi

# ---- 5. 拉 caddy 镜像 ----
echo -e "${YELLOW}-- 拉 caddy 镜像 --${NC}"
docker pull caddy:2-alpine

# ---- 6. 停旧容器 (如果有) ----
if docker ps -a --format '{{.Names}}' | grep -qE 'zzmm-(nextjs|caddy)'; then
    echo -e "${YELLOW}-- 停旧容器 --${NC}"
    docker compose down --remove-orphans
fi

# ---- 7. 构建 + 启动 ----
echo -e "${YELLOW}-- 构建 Next.js 镜像 (5-10 分钟, 首次) --${NC}"
docker compose build --pull
echo -e "${YELLOW}-- 启动 --${NC}"
docker compose up -d

# ---- 8. 等待 + 健康检查 ----
echo -e "${YELLOW}-- 等待 30 秒 + 健康检查 --${NC}"
sleep 30
docker compose ps

# ---- 9. 内部健康检查 ----
if docker exec zzmm-nextjs wget -q --spider http://localhost:3000/ 2>/dev/null; then
    echo -e "${GREEN}✅ Next.js 内部 200 OK${NC}"
else
    echo -e "${YELLOW}⚠️  Next.js 内部 200 失败, 看日志:${NC}"
    docker logs zzmm-nextjs --tail=30
fi

# ---- 10. Caddy SSL 状态 ----
echo -e "${YELLOW}-- Caddy SSL 状态 --${NC}"
docker logs zzmm-caddy --tail=30 | grep -iE "certificate|https|tls|listen" || true

# ---- 11. 外部测试 ----
echo -e "${YELLOW}-- 外部测试 (http://localhost:3000) --${NC}"
curl -sI http://localhost:3000/ | head -5 || true

# ---- 12. 完成 ----
echo
echo -e "${GREEN}== 部署完成 ==${NC}"
echo "本机: http://localhost:3000"
echo "公网: https://zzmm-search.uk  (等 5-30 分钟: DNS 生效 + Caddy 自动 SSL 申请)"
echo
echo "常用命令:"
echo "  cd $APP_DIR && docker compose ps              # 看状态"
echo "  cd $APP_DIR && docker compose logs -f         # 实时日志"
echo "  cd $APP_DIR && docker compose restart         # 重启"
echo "  cd $APP_DIR && docker compose down            # 停"
