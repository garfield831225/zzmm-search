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

## 前端 fetch 三条铁律（2026-11-07 血泪）

### ① 后端 500 ≠ 搜不到，必须查 `res.ok`
`fetch` 拿到 500 时 body 往往**也是合法 JSON**（`{error: '...'}`）。
不查 `res.ok` 就直接 `data.items` → `undefined` → `setItems([])` → **页面渲染成白板**。
用户分不清「服务器炸了」还是「站里没这资源」⇒ 直接把「服务挂了」显示成「搜不到」。
（moviezone 那边踩了同一个坑：`assets/app.js` 的 `bff()` 静默吞 fetch 失败。）
**修法**：查 `res.ok` → 抛错 → 挂错误条 + 重试按钮；失败时**不要清空 items**。

### ② `setState` 之后同步读 state = 读到旧值
```tsx
// ❌ setQuery 是异步的，紧接着 fetchItems 读 latestRef.current.query 还是旧值
onSearch={(q) => { setQuery(q); fetchItems(1); }}
// ✅ 跟同文件 setPageSize 的写法对齐：同步先改 ref
onSearch={(q) => { latestRef.current = { ...latestRef.current, query: q }; setQuery(q); fetchItems(1); }}
```
**这条曾让首页搜索框完全失效**（输入「逆天邪神」回车 → 请求 `q=null` → 返回默认列表，
8 张卡片 0 个命中）。引入于 `aa9e8045`。**首页搜索框现在是真的能搜了**。
排查同类问题时：抓 Playwright 的 `/api/search` 请求 URL，看 `q=` 在不在。

### ③ fetch 必须带超时
NAS 高负载（loadavg 18）时 `/api/search` 登录态实测 **4~9.5s**，
挂起的请求会把页面卡在空白。用 `AbortController` + `setTimeout(45000)`，
超时要给用户明确文案，不要静默。

### ④ 空状态也要说话
0 条时网格高度为 0，页面下半截整片白板，用户以为页面坏了。
必须显式渲染「没有找到相关资源」+ 加载中态（`loading && items.length === 0`）。

## PG 匹配候选池实测（2026-11-07 只读核实，别再拍脑袋估数字）

**结论：存量匹配的候选池是 262,492 行，不是之前记的 97,247（97,247 是某次试跑的命中数）。**

| 口径 | 数字 |
|---|---|
| active 总数 | 469,765 |
| **有有效 tmdb_id**（纯数字且 >10000） | **142,675 = 30.37%** |
| `xx_tmdb_cache` | 38,559 行（34,243 有海报） |
| **匹配候选池** | **262,492** |

候选池的 SELECT 条件（`src/app/api/admin/match/route.ts`）：
`status='active' AND (tmdb_id IS NULL OR tmdb_id='' OR tmdb_id IN ('NOMATCH','GARBLED')) AND name IS NOT NULL AND LENGTH(TRIM(name))>1 AND category NOT IN ('音乐','体育','合集','学习资料','其他','游戏','电子书','精品课','文档')`

**候选池按 access_level 拆**（证明没有只匹配 vip 的坑）：
- vip **252,489**（96.2%）｜free **9,806**（3.7%）｜code 172｜basic 25

### 🔥 两个会「静默少一半」的坑（都不报错）
1. **access_level 只匹配 vip** —— ⚠️ **我这边没有**。已逐处核实：
   `scripts/match-direct.mjs`（PG，match-now 就是 spawn 它）里 `access_level` 出现 **0 次**；
   `/api/admin/match` 的 SELECT、`scripts/rematch-worker.cjs` 的 SELECT+UPDATE 均无该条件。
   （moviezone 那边**有**这个坑：`functions/api/index.ts` 的后台匹配端点 `only_vip` 默认 true，
   会跳过 146,588 行 basic 且不报错 —— 要跑全表必须传 `{"only_vip": false}`。）
2. **分类排除表静默挡掉 1.6 万行** —— ⚠️ **我这边有**。
   上面那条 `category NOT IN (...)` 挡掉 **24,147 行**带 NOMATCH 的资源：
   其他 7,235 / 电子书 4,307 / 文档 2,618 / 精品课 1,971（这四条是**分类错位**，不是该排除）
   ｜音乐 6,933 / 合集 862 / 体育 210 / 游戏 11（这几条确实不该匹配）
   ⇒ **不先重分类，这 1.6 万行永远拿不到海报。**

### `tmdb_id IS NULL` 是空集
PG 里 active 的 `tmdb_id IS NULL` = **0 行**，262,492 全是 `tmdb_id='NOMATCH'`（262,470）。
⇒ `scripts/rematch-worker.cjs` 注释里那句「必须同时捞 tmdb_id IS NULL 的行」在 PG 上捞不到东西，**别被误导**。

### NOMATCH 分布（重跑收益排序）
动漫 84,363 ｜短剧 82,595 ｜剧集 57,609 ｜电影 26,654 ｜原盘 5,404 ｜其他 2,884 ｜演唱会 2,365 ｜软件 1,791

### 重跑的账（等用户拍板，勿擅自执行）
- TMDB 请求量：262,492 × 1~2 次 ≈ **26~52 万次**；按 40~50 req/s ≈ **1.5~3.6 小时**纯 API 时间
- 写回：NAS 上 26 万行 UPDATE（当前 NAS load 21、swap 16.2G 在颠簸 —— **这才是拦路虎**）
- 写生产库必须用户拍板；不建定时器
