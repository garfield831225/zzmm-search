# zzmm-search 部署协调 (多 session 冲突)

## 根因
多个 session 同时 build + 部署到 NAS `/data_s001/docker/zzmm-search/.next/standalone/`，互相覆盖。

## 解决
**flock 互斥部署**，NAS 上 `/data_s001/deploy.lock` 作为 lock 文件。

### 部署脚本
- NAS: `/tmp/zzm-deploy-safe.sh` (本仓库根 `zzm-deploy-safe.sh`)
- 桌面端: `C:\Users\Administrator\_zzmm_deploy_safe.cjs`

### 流程
1. `flock -n /data_s001/deploy.lock` 拿锁（非阻塞）
2. 拿不到 → ABORT exit 1
3. 拿到 → systemctl stop → rm -rf → untar → cp env/static/public → start → verify
4. 释放锁 (auto, on exit)

### 验证 (8-21 11:30)
- DEPLOY1: GOT_LOCK → DONE
- DEPLOY2: BLOCKED (deploy1 持锁)
- DEPLOY3: GOT_LOCK (deploy1 释放后)

## 使用
```bash
# 桌面端 (Windows)
node C:\Users\Administrator\_zzmm_deploy_safe.cjs

# 可选 flags
# --no-build: 跳过 build (source 已 build)
# --no-upload: 跳过 scp tar (tar 已在 NAS)
```

## 紧急
- 锁卡死 (>15min): `sudo rm /data_s001/deploy.lock`
- BFF 路由 404: 重新 deploy

## commit 历史 (BFF 相关)
- `51d7ca3` feat(bff): add /api/zzmm-bff catch-all proxy to NAS BFF port 3007
- route: `src/app/api/zzmm-bff/[...path]/route.ts` (2.6KB)
- 转发到 `localhost:3007/api/{path}` (BFF 端口)

## 写给其他 session
请：
1. **部署前** `git pull origin main` 拿最新 BFF route
2. **用本仓库的部署脚本** (`_zzmm_deploy_safe.cjs` 或 `zzm-deploy-safe.sh`) 走 flock
3. **不要直接** rm -rf /data_s001/docker/zzmm-search/.next/standalone/ (会破坏另一 session 的部署)

---
最后更新: 2026-08-21 11:30 by Mavis (mvs_7e858fa2094a4f91a19f77548a9a7f90)
