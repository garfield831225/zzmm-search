# match-direct Docker 镜像
# 用途: 直连 Neon DB 跑批量匹配, 完全不打 Vercel, 0 Vercel 消耗
# 部署: 极空间 NAS Docker 套件 (或者任何 Docker host)

FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json (跟 zzmm-search 项目同 package.json, 复用 @neondatabase/serverless)
COPY package.json ./

# 只装 production 依赖
RUN npm install --omit=dev --no-audit --no-fund

# 复制 match-direct.mjs
COPY match-direct.mjs ./

# 默认跑 1 次 (cron 调用)
CMD ["node", "match-direct.mjs"]
