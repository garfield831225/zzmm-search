# zzmm-search NAS 部署

> **从 Vercel 全量搬到极空间 Z4 Pro** · 域名 `zzmm-search.uk` · Cloudflare proxy
> 部署完成 = Vercel 月烧 $20 = 0

## 架构

```
[用户浏览器]  https://zzmm-search.uk
     ↓
[Cloudflare CDN/proxy]  (隐藏 NAS 真实 IP, 抗 DDoS)
     ↓  (SSL 模式 = Full)
[NAS 公网 IP 223.72.106.229:443]
     ↓
[Caddy (Docker)]  ← 自动 Let's Encrypt 证书 + 反代
     ↓
[Next.js standalone (Docker, port 3000)]
     ↓
[Neon Postgres 远程]  (24 万资源, 不搬)
```

## 一次性准备

### 1) NAS 网络/防火墙

极空间后台开 2 个端口（路由器也要开，DMZ/UPnP）：

| 端口 | 用途 | 方向 |
|------|------|------|
| 80 | Let's Encrypt HTTP-01 challenge | 入站 |
| 443 | HTTPS (用户访问) | 入站 |

### 2) NAS Docker

极空间后台 → Docker → 镜像仓库 → 确认有 `caddy:2-alpine`。

(Next.js 镜像本地 build, 不需要预拉取)

### 3) 环境变量

`.env.production` 需要从 Vercel 当前环境变量拷过来。

去 Vercel Dashboard → Project → Settings → Environment Variables, 抄：
- `DATABASE_URL`
- `JWT_SECRET` ⭐ **不能漏, 不然所有用户 token 失效踢出**
- `JWT_EXPIRES_IN`
- `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`
- `TMDB_API_KEY`
- `SITE_NAME` / `SITE_URL` / `ADMIN_EMAIL` / `WECHAT_CONTACT`

NAS Docker 里 Redis: 极空间如果有 Redis 容器, 用 `host.docker.internal`。
如果没有, 暂时去掉 REDIS_*, 改用内存缓存 (性能差一点)。

## 部署步骤

```bash
# SSH 上 NAS
ssh 13381064903@223.72.106.229 -p 10000
# 密码: @G831225dd

# 拉代码 (假设 clone 到 /volume1/docker/zzmm-search)
cd /volume1/docker/zzmm-search
git pull

# 跑一键部署
bash docker/deploy-nas.sh
```

首次跑 5-10 分钟 (npm install + build), 之后秒起。

## 部署后检查

```bash
# 容器状态
docker compose ps

# 实时日志
docker compose logs -f

# 内部 health check
docker exec zzmm-nextjs wget -q --spider http://localhost:3000/ && echo "Next.js OK"
docker logs zzmm-caddy --tail=30
```

## Cloudflare SSL 配置 (1 次)

域名 `zzmm-search.uk` → Cloudflare → SSL/TLS → Overview → **Full**

不要选 Flexible (CF → NAS 走 HTTP 不安全)
不要选 Full (strict) 除非有 CF Origin Certificate

## 旧域名 301 (可选)

`zzmm-search.cc.cd` 想保留 → 在 Cloudflare 加 Page Rule:

`zzmm-search.cc.cd/*` → Forwarding URL → 301 → `https://zzmm-search.uk/$1`

## match-direct 跑批 (替代 Vercel cron)

把 `vercel.json` 的 cron 删掉, NAS 跑 match-direct:

```bash
# 极空间后台 Docker 新建容器, 用现成的 docker/match-direct
# 或 SSH 跑:
cd /volume1/docker/zzmm-search
node docker/match-direct/match-direct.mjs
```

GUI cron 每天凌晨 3 点跑一次, 完全不耗 Vercel。

## 停 Vercel (不删代码)

Vercel Project → Settings → Danger Zone → Pause Project

代码保留, 不再 push, 不再烧钱。

## 回滚方案

如果 NAS 跑挂:
1. `ssh nas` → `cd /volume1/docker/zzmm-search`
2. `git log --oneline -5` → 找到上一个 OK 的 commit
3. `git reset --hard <commit>` → `bash docker/deploy-nas.sh`
4. 旧域名 301 反向, Vercel 重新启用

## 维护

- **重启**: `cd /volume1/docker/zzmm-search && docker compose restart`
- **更新代码**: `git pull && bash docker/deploy-nas.sh`
- **看占用**: `docker stats`
- **看磁盘**: `df -h /volume1`
