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

## 🔥 NAS 匹配器 3.5 天零命中：三个叠加的坑（2026-11-07 定位并修复）

**现象**：`xx_resources.matched_tmdb_at` **最后成功是 2026-11-04 02:18 CST**，之后连续 3.5 天**零命中**；
覆盖率停在 30.37%（142,675 / 469,765）。看起来像「TMDB 挂了 / 配额用完」，实际是三个独立 bug 叠加。

### 坑 1：代理被 `zzm_neon_proxy_patch.mjs` 抹掉（静默全判 NOMATCH）
```
scripts/zzm_neon_proxy_patch.mjs (import 时执行):
  process.env.HTTP_PROXY = '';        ← 清空
scripts/match-direct.mjs (模块体):
  loadEnvFile(ENV_FILE)               ← 看到 HTTP_PROXY 是空串(falsy) → 从 .env.production 读回
                                        已失效的 http://192.168.3.3:12348 → 覆盖掉外部 export
  const PROXY_URL = process.env.HTTP_PROXY || ...   → 12348（CLOSED）
```
⚠️ **ESM 的 import 先于模块体执行**，所以「先 export 再跑脚本」根本挡不住这个 patch。
⇒ 修法：在 `loadEnvFile` **之前**钉死 `process.env.HTTP_PROXY`（env 已有值时 loadEnvFile 不会覆盖）。
⇒ 现状：`192.168.3.3` 上 **7890 / 7897 OPEN，12348 / 12334 / 17890 CLOSED**；**NAS 直连 TMDB 也能通**（200，~0.9s）。

### 坑 2：名字清洗把 `【...】` 块整个留下 → TMDB 搜索恒 0 结果
`cleanFolderName` 只掏掉块**里面**的 1080p/4K 词，**括号本身留着**：
```
"唐顿庄园(六季合集)【1080p 原盘REMUX】【内封简英双语特效字幕】【剧情/家庭】"
→ "唐顿庄园(六季合集)【 原盘 】【内封简英双语特效字幕】【剧情/家庭】"   ← 搜不到
```
修法（在 matchOne 里，拿到 cleanName 之后追加一遍）：
① 剥掉所有 `【...】` 和 `[...]` 块 ②剥掉非年份的中文括号 ③去掉 `年番/剧版/合集/更N集/更新至N集` 等标记。

### 坑 3：`ORDER BY created_at DESC` 让匹配器原地打转
最新导入的行名字最脏 → 永远被优先挑中 → 5 分钟冷却一过又挑同一批 → **永远推进不了**。
⇒ 改成 `ORDER BY last_attempt_at ASC NULLS FIRST`（最久没试过的先试）才会向前扫。

### 附带修：假阳性护栏
实测「书籍」「国漫」「刑侦」「喜剧」这类泛词会被匹配到**任意** TMDB 条目 → 往库里写错 tmdb_id。
⇒ 加泛词黑名单 + `cleanName.length < 3` 直接判 NOMATCH。

### 命中率实测（修复后）
| 样本 | 命中率 |
|---|---|
| 从未试过的老行（大量图书教材错归影视类） | 4.0%（且多为真·不该匹配） |
| 主力已尝试人群（真影视资源） | **16.5%**（电影 18.7% / 剧集 17.1%） |

### 本次运行的配置
- 脚本：`scripts/match-direct-vip.mjs`（**NAS 上的副本，原 `match-direct.mjs` 一个字没动**，md5 仍是 `5e22e5ad...`）
  —— 因为 NAS 那份与本地 repo 不是同一版（本地 md5 `d6a9995d...`），直接覆盖会丢改动。
- 与原脚本的差异：①`access_level='vip'` 过滤 ②强制代理 ③名字清洗 ④取行顺序 ⑤假阳性护栏 ⑥调试日志
- 备份表：`xx_rematch_backup_20261107`（276,628 行，可回滚 tmdb_id / matched_tmdb_at / last_attempt_at）
- systemd：`zzmm-rematch-vip.service`（Nice=19 + ionice idle + Restart=on-failure）
  启动：`systemctl start zzmm-rematch-vip.service`　停止：`systemctl stop zzmm-rematch-vip.service`
- 实测速度：200 行/轮 × ~45s ≈ 4.4 行/s → 全量 276,628 行约 **17 小时**（后台跑，不阻塞站点）
- 调试开关：`MATCH_DEBUG=1` 时脚本会打 `[dbg] CLEAN2 / SEARCH / 0results / MATCH` 到日志

⚠️ **别再犯**：改任何走 TMDB 的脚本前，先确认
①`process.env.HTTP_PROXY` 在 patch 模块之后仍然正确 ②清洗后的名字能直接搜到 ③取行顺序不会原地打转。]<]minimax[>[</newString>]<]minimax[>[</invoke>
]<]minimax[>[</tool_call>

## 🔥 清洗器 A/B 实测 + 「垃圾条目」陷阱（2026-11-07 实测，必读）

### ① 两个清洗器 A/B（同一批 PG 300 行 / 同一套 TMDB 探测 / 同一判分标准）
| | 真命中 | 占比 | 未命中 | 假阳性 | 跳过 |
|---|---|---|---|---|---|
| A = `match-direct-vip.mjs` 的清洗补丁 | 18 | 6.0% | 273 | 5 | 4 |
| B = 拾光的 `rematch-worker.clean-title.cjs` | **62** | **20.7%** | 203 | 24 | 11 |

两者都命中 16 / **只有 B 命中 46** / 只有 A 命中 2 / 都没中 236
⇒ **clean-title 抽片名强 3.4 倍**，用户拍板换新引擎（`rematch-worker` + clean-title）。
A 的典型失败：噪声留在片名里 → `沧元图 动作 动画 奇幻 4KHQ 更新76集`（TMDB 搜不到）；B → `沧元图` ✓
脚本：NAS `scripts/ab/ab-runner.cjs`（只读）｜明细 `logs/ab-clean-title.json`

### ② 🔥 最阴的坑：字幕组**编码标签**被当片名 → 匹配到真存在的垃圾条目
清洗器把 `【GB】`/`【Big5】` 当成片名 → TMDB 搜 "GB" 返回**真存在**的条目 `Hotel GB`、搜 "Big5" 返回 `Big5 Türkiye`
→ 前缀匹配 `startsWith` **没有长度差上限** → 直接接受 → 写库。
实测后果：我这一轮 2,448 条写入里 **683 条（27.9%）是错配**，其中 **390 条正是这一类**（动漫重灾区 524/683）。
⇒ 两条铁律：
1. **前缀匹配必须限长度差**（`tn.length - cn.length <= 4`）
2. **噪声词表必须含 GB / Big5 / BIG5 / GBK / 简日 / 繁中 / (字幕组|压制组|发布组) 这类编码标签**
（`isNoiseOnly` 的开头黑名单只有「国语/英语/字幕/内封/简繁/双语/特效…」这类，**不含编码标签** ⇒ 别照抄）

### ③ 写库前必须有「分级置信度」闸
新引擎 `rematch-worker.cjs` 的做法（比 `match-direct-vip` 严，**照这个来**）：
exact=100 / prefix=90 / substr=80 / 反向包含=75 / bigram≤60 / fuzzy=30，
**`best.score < 30` 直接放弃**；默认**只有 exact/prefix/substr 才写库**（`--allow-fuzzy` 才放开 bigram/fuzzy）；
每条写库落一行 jsonl 审计（可按 id 精确回滚）。
⇒ **别把「拿到 TMDB 第一条结果就写库」当默认。**

### ④ `tmdb_id` 列里混着失败标记，统计覆盖率只能用数字口径
| PG 侧 (status='active', 共 469,765) | 行数 |
|---|---|
| **NUMERIC（真匹配）** | **154,503（32.9%）** |
| `NOMATCH` | 264,983 |
| `SKIP` | 30,847 |
| `GARBLED` | 68 |
| NULL / '' | 19,364 |

⇒ 真实覆盖率 = `count(*) filter (where tmdb_id ~ '^[0-9]+$')`；
**`tmdb_id IS NOT NULL` 会把 29.8 万行假标记算成「已匹配」**，报出去的数字会离谱地好看。
⚠️ `SKIP` 30,847 行是**死角**：新旧两个引擎的 WHERE 都只认 `NULL/NOMATCH`（新引擎还不认 `GARBLED`）⇒ 这批永远不会被重试。

### ⑤ NAS 直连 TMDB 可用（推翻「Node fetch 直连必超时」）
实测：NAS 直连 `api.themoviedb.org` curl 200（0.265~0.95s）、Node fetch 200、3 个 key 全通；
`match-direct-vip.mjs` 第 45 行用的是 `new Agent()`（**不是 ProxyAgent**）⇒ `HTTP_PROXY` 只被 log，实际全程**直连**，
106,200 行跑完命中 2,448；A/B 那 571 次直连探测 **0 次超时**。
⇒ **走代理反而更容易 `fetch failed`**，别把「直连必超时」写进新引擎。

### ⑥ 审计与回滚资产（2026-11-07）
- 审计脚本：NAS `scripts/ab/audit-local.cjs`（拿 `xx_tmdb_cache` 的官方标题回比，不打 TMDB）
- 我这轮写入清单：`logs/my-writes-audit.psv`（2,446 行）、明细 `logs/my-writes-audit.json`
- 回滚 SQL：`logs/rollback-my-bad-matches.sql`（口径 A=391 纯垃圾 / 口径 B=683 全部疑似；**未执行，等用户拍板**）
- 回滚依据表：`xx_rematch_backup_20261107`（276,628 行，含原 tmdb_id/matched_tmdb_at/last_attempt_at）

### ⑦ 跑批现状（2026-11-07 11:51 CST 停）
- 用户拍板：PG 存量匹配换新引擎（拾光 `rematch-worker` + clean-title，rps=20 / 5 段并行）
- `zzmm-rematch-vip.service` **已停**；停服前 **531 轮 / 106,200 行 / 命中 2,448**（已落 PG，不会丢）
- 备份表 `xx_rematch_backup_20261107` 保留（两边都能回滚）
- 新引擎三个必改项（已发拾光）：① prefix 长度差 ② GB/Big5 噪声词 ③ `access_level='vip'` 过滤（它原版没有）
