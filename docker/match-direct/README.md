# match-direct 极空间 NAS 部署

## 这是什么

直连 Neon DB 跑批量匹配,**完全不打 Vercel**,**0 Vercel CPU 消耗**。

之前的 Vercel 触顶 Paused 就是因为从本地 Windows 通过 HTTP 调 Vercel match-task 端点 200+ 次,跑光了 4h/日 CPU。`match-direct.mjs` 直接连 Neon 数据库,绕开 Vercel,治本。

## 性能 (实测)

- 200 条/批, ~30-60 秒
- 16 万 null 资源 ÷ 200 = 800 批 × 60 秒 = 13 小时跑完
- 也可以设大点 (1000 批 = 20 万资源)

## 极空间 NAS 部署步骤

### 前置条件

1. 极空间 Z4 Pro 装好 **Docker 套件** (极空间自带)
2. 极空间 SSH 开了 (控制台 → 远程访问 → 开启 SSH)
3. 知道极空间内网 IP (如 `192.168.3.8`)
4. Neon 直连 endpoint + 密码 (跟 Vercel env 一样)

### 步骤 1: 复制文件到 NAS

在 Windows 上:
```powershell
# 把整个 docker/match-direct 目录 scp 到 NAS
scp -P 10000 -r "C:\temp_zzmm\zzmm-search\docker\match-direct" 13381064903@192.168.3.8:/volume1/docker/zzmm-match-direct/
```

或者用极空间 web 文件管理 (推荐):
- 浏览器打开 `http://192.168.3.8` (极空间 web)
- 登录 → 文件管理 → 进 `/docker/` 目录 (没有就建)
- 上传 `match-direct` 整个目录 (3 个文件: Dockerfile, docker-compose.yml, match-direct.mjs)

### 步骤 2: 修改 DATABASE_URL (如果需要)

打开 `docker-compose.yml`,把 `DATABASE_URL` 改成你的实际连接串。

注意:
- 必须是 **直连 endpoint** (没 `-pooler`)
- 格式: `postgresql://neondb_owner:npg_XXX@ep-XXX.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

### 步骤 3: 极空间 GUI 部署

1. 极空间 → Docker → 容器 → **Compose** (不是单容器)
2. 点 **新建** → 选 `docker-compose.yml` 文件
3. 项目名: `zzmm-match-direct`
4. 点 **部署** / **启动**

容器启动后:
- build image (~2 分钟, 下载 node + npm install)
- 跑 match-direct.mjs
- 跑完 200 条 (~60 秒)
- **容器自动停止** (restart: "no")

### 步骤 4: 看日志

极空间 → Docker → 容器 → zzmm-match-direct → **日志**

应该看到类似:
```
🚀 match-direct.mjs - 本地直连 Neon DB 批量匹配
   BATCH_PER_RUN: 200 CONCURRENCY: 20
   📊 初始 null 资源总数: 159700
batch 1 - processed=200 matched=X nomatch=Y garbled=...
...
```

### 步骤 5: 循环跑 (跑完 16 万)

match-direct 默认只跑 1 批 (200 条)。要跑完 16 万,改 `match-direct.mjs` 里的 `MAX_BATCH`:

```js
const MAX_BATCH = 800;  // 800 批 × 200 = 16 万
```

或者用 NAS GUI cron 每天跑 1 次。

## 定时跑 (极空间 GUI cron)

NAS 不想手动跑,可以用极空间定时任务:

1. 极空间 → 控制面板 → **计划任务** / **定时任务**
2. 新建任务:
   - 任务名: `zzmm-match-direct-daily`
   - 周期: **每天凌晨 3:00** (避开 Vercel 业务流量高峰)
   - 任务: **重启容器** / **运行 docker compose up**
3. 每天自动跑,容器跑完自动退

## 故障排查

### 容器 build 失败
- 检查 Docker 套件版本 (极空间 Z4 Pro 应该是 Docker 20+)
- 检查 internet (要拉 node:20-alpine 镜像)

### 容器跑起来 0 processed
- 检查 DATABASE_URL 是不是**直连** (没 `-pooler`)
- 在容器内 `node -e "console.log(process.env.DATABASE_URL)"` 看 env

### Neon 慢 / 限速
- 调 `BATCH_PER_RUN` 变小 (50 条/批)
- 调 `CONCURRENCY` 变小 (10 并发)

## 不需要 cloudflared

match-direct 是**离线后台任务**,不需要暴露公网,**不需要 cloudflared tunnel**。

如果哪天要把 Next.js 整个搬到 NAS (生产环境),才需要 cloudflared,另写文档。

## 跟 Vercel 配合

- Vercel 跑业务流量 (search/catalog/admin)
- NAS 跑批量匹配 (match-direct)
- Vercel cron `0 2 * * *` 业务匹配保留
- match-direct 每天 NAS 跑 1 次 (业务匹配 + 补充匹配)
- 互相不冲突, Vercel 配额不被吃光
