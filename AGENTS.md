# zzmm-search 项目关键决策 (2026-06-01)

## TMDB 匹配逻辑（必须严格遵守，不得自行"优化"）

**所有 TMDB 匹配代码必须参考 `src/app/api/cron/match-task/route.ts` 的 `getTypesForCategory` 函数。**

```typescript
function getTypesForCategory(category: string, sub_type: string | null, season: number | null) {
  if (season !== null) return ['tv'];
  if (category === '连载' || category === '剧集' || category === '动漫' || category === '少儿频道' || category === '综艺') return ['tv'];
  if (category === '演唱会' || category === '电影' || category === '系列电影') return ['movie'];
  if (category === '纪录片') return ['tv', 'movie'];
  if (category === '原盘') {
    if (['电影', '动画电影', '演唱会', '3D原盘'].includes(sub_type || '')) return ['movie'];
    return ['tv'];  // 原盘默认先 TV，不是 multi，不是先 movie
  }
  if (category === 'REMUX') return ['movie'];
  return null;
}
```

### 核心原则
- **原盘默认查 `movie`**：没有 sub_type 的原盘资源默认查 TMDB movie 类型。
- **4K原盘**：`sub_type=电影`，查 `movie`。
- **3D原盘**：`sub_type=3D原盘`，查 `movie`。
- **严禁用 `search/multi`**：不能用 `multi` 类型代替类别判断，所有搜索必须指定类型。
- **搜索 API 也必须遵守**：任何新写的搜索/匹配逻辑必须参考此函数。

## 前端 fetch 鉴权（必读，2026-06-11 踩坑）

**所有前端 fetch 调用后端 API 必须带 JWT token header，不能只靠 `credentials: 'include'`！**

JWT 存在 `localStorage`（key 不固定：`zzmm_token` / `token` / `adminToken`），cookie 没存 token，**只 credentials 会 401**。

```typescript
// 必须这样写（参考 src/app/vip-videos/page.tsx）
function getAuthHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const t = localStorage.getItem('zzmm_token')
    || localStorage.getItem('token')
    || localStorage.getItem('adminToken');
  return t ? { Authorization: 'Bearer ' + t } : {};
}

const r = await fetch('/api/xxx', {
  credentials: 'include',  // 也带, 防 cookie
  headers: getAuthHeaders() // 必带！
});
```

**所有需要鉴权的 API**（access.ts 里的 `requireAccess` / `requireAdmin`）的前端调用方都要这么写。**新加 API 页面时**——`/games /games/[id]` 就是反例（之前只 credentials，403 全空）。

## 新增 API 路由的 middleware 放行（必读，2026-06-11 踩坑）

**每次新增 `/api/xxx/*` 路由，必须在 `src/middleware.ts` 的 `PUBLIC_PATHS` 加一行！**

否则：用户登录态在 localStorage（不在 cookie），middleware 拿不到 cookie token → **重定向到 /login** → API 返回 HTML → 前端 `r.json()` 解析失败 → **"Unexpected end of JSON input"**。

```typescript
// src/middleware.ts
const PUBLIC_PATHS = [
  // ...
  '/api/games',           // ← 每次新加 API 都要追加
  '/api/games/platforms',
  // 鉴权交给后端 requireAccess
];
```

**前车之鉴**：`/api/games` 第一次部署忘了加，403/HTML 错误。`/api/vip-videos` 当时加了所以没事。**新加 API 必查**。

## 两套数据库：PG（站点读） vs Neon（moviezone 读）（2026-11-06 核实）

**别把两边的数字混着报/比 —— 它们是两个独立快照，`sync-pg-to-neon.sh` 不同步 `xx_resources`。**

| 口径 | PG（NAS 127.0.0.1:5432/zzmm_search，站点读） | Neon（moviezone / CF Pages 读） |
|---|---|---|
| xx_resources 总数 | 480,450（active 469,765 / deleted 10,685） | 403,271 |
| id 上限 | 2,966,260 | 2,125,395 |
| access_level='vip' | 414,150 | 256,680 |
| access_level='free' | **65,452** | **0** |
| access_level='basic' | 333 | **146,588** |
| access_level='code' | 515 | 3 |

- **`access_level` 的合法值有 4 个**：`'basic' | 'vip' | 'code' | 'free'`。
  `'free'` 是 2026-09-29 之后才出现的新值（以「原盘」为主，65,452 行）。
  → 任何写 `access_level IN (...)` 的地方**必须包含 `'free'`**，否则漏掉 6.5 万条。
- **搜索路由 2026-10-29 起已完全去掉 access_level 过滤**（`src/app/api/search/route.ts`）——
  业务铁律：VIP 锁只在前端展示，不卡后端。新写查询别再把 access_level 当权限字段用。
- 查 Neon 真身要用 `/data_s001/docker/zzmm-search/.sync-pg-to-neon.env` 里的 `NEON_URL`。
  ⚠️ `zzm-neon-proxy.service`（127.0.0.1:4444）**不是 Neon 代理**，它是「Neon HTTP 协议 → 本地 PG」的转换器
  （`DATABASE_URL` 指向 `127.0.0.1:5432/zzmm_search`）—— 拿它查到的全是 PG 数据。
- `xx_users.group` 除 user/basic/vip/admin 外，PG 里还有 `viewer` / `member`，
  按上游 middleware 属于「未激活」，会被 `addCond('1=0')` 挡掉 —— **这是业务铁律，不放开**。
