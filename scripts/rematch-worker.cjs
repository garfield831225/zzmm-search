#!/usr/bin/env node
// ============================================================================
// 存量 NOMATCH 批量重跑 worker (2026-10-29)
// ----------------------------------------------------------------------------
// 为什么要在 NAS 上常驻跑 (而不是本机):
//   1. 本机 Windows 后台任务超过几分钟就会被 harness 强杀 (exit 4294967295)
//   2. NAS 直连 api.themoviedb.org 实测 200 OK (0.7~3s/次), node v22 自带
//   3. 数据盘 /data_s001 还有 3.6T, 不占系统盘 (系统盘 79% 满)
//   4. 跑完就退出, 不常驻; 断电/重启后用 state 文件续跑
//
// 关键设计 (对比 scripts/rematch-nomatch.cjs 的改进):
//   A. **游标分页** (id > cursor) 代替 OFFSET —— OFFSET 在 NOMATCH 集合不断缩小时会跳行
//   B. **片名级去重缓存** (JSONL 落盘) —— 321097 行只有 264611 个不同 name,
//      清洗后不同片名更少; 同一个片名只查一次 TMDB, 直接省掉大量 API 调用
//   C. **分级置信度写库** —— exact/prefix/substr 才写, bigram/fuzzy 默认只统计
//   D. **staging 表 + COPY FROM STDIN** —— 避免 psql -c 参数超 128KB 限制
//   E. **写缓存表 xx_tmdb_cache** —— 海报走 LEFT JOIN xx_tmdb_cache, 只改 tmdb_id 没海报
//
// 用法 (NAS 上):
//   node rematch-worker.cjs --after-id 0 --chunk 500 --conc 10 --rps 8 \
//        --state-dir /data_s001/docker/zzmm-search/.rematch
//   --cats a,b     只跑指定分类 (默认全部可匹配分类)
//   --dry          只匹配不写库
//   --allow-fuzzy  bigram/fuzzy 也写库 (默认不写)
//   --max-rows N   本次最多处理 N 行 (0 = 不限)
//   --stop-after-ms N  单批最长耗时 (默认 90000, 避免一批太大被外部中断)
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// ── 参数 ──────────────────────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const arg = (k, d) => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : d; };
const has = (k) => ARGS.includes(k);

const STATE_DIR = arg('--state-dir', '/data_s001/docker/zzmm-search/.rematch');
const CHUNK = parseInt(arg('--chunk', '500'), 10);
const CONC = parseInt(arg('--conc', '10'), 10);
let RPS = parseFloat(arg('--rps', '8'));
const ALLOW_FUZZY = has('--allow-fuzzy');
const DRY = has('--dry');
const CATS = (arg('--cats', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const START_ID = parseInt(arg('--after-id', '0'), 10);
const MAX_ROWS = parseInt(arg('--max-rows', '0'), 10);
const STOP_AFTER_MS = parseInt(arg('--stop-after-ms', '90000'), 10);
// 跳过最近 N 小时内被处理过的行 (跟 cron 抢活 / 别的 worker 实例刚跑过)
const MIN_AGE_HOURS = parseInt(arg('--min-age-hours', '6'), 10);

const TMDB_KEYS = ['7985342d5961e9ee3d5ef6d969c1b8dd', '79e41efe870e60afb09b9de8baa47cf1'];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const PG_CONTAINER = 'postgresql';
const PG_USER = 'hyperms';
const PG_DB = 'zzmm_search';

// ── 片名提取器 (从 src/lib/clean-title.ts 打出来的 bundle) ─────────────────
let cleanFolderName;
try {
  ({ cleanFolderName } = require(path.join(__dirname, 'rematch-worker.clean-title.cjs')));
} catch (e) {
  console.error('找不到 rematch-worker.clean-title.cjs, 先跑: node scripts/build-rematch-worker.cjs');
  process.exit(1);
}

// ── 分类 → TMDB 类型 (跟 src/lib/categories.ts 同源) ──────────────────────
const SKIP_MATCH_CATEGORIES = new Set([
  '软件', '音乐', '电子书', '文档', '精品课', '学习资料', '有声书',
  '游戏', 'PC游戏', 'Swtich游戏', '体育', '导航首页', '合集',
]);
const TV_ONLY = new Set(['连载', '剧集', '动漫', '综艺', '少儿频道', '短剧']);
const MOVIE_ONLY = new Set(['电影', '华语电影', '外语电影', '动画电影', 'REMUX', '系列电影']);

function typesFor(category, subType, season) {
  if (SKIP_MATCH_CATEGORIES.has(category)) return null;
  if (season !== null) return ['tv'];
  if (TV_ONLY.has(category)) return ['tv'];
  if (category === '演唱会') return ['movie'];
  if (category === '纪录片') return ['tv', 'movie'];
  if (category === '原盘') {
    if (['电影', '动画电影', '演唱会', '3D原盘'].includes(subType || '')) return ['movie'];
    return ['tv'];
  }
  if (MOVIE_ONLY.has(category)) return ['movie'];
  if (subType && ['剧集', '韩剧', '欧美剧', '港台剧', '国产剧', '日剧', '动漫', '动画', '综艺', '纪录片', '少儿', '演唱会', '连载', '短剧', '微短剧'].some(t => subType.includes(t))) return ['tv'];
  return ['movie', 'tv'];
}

// ── 工具 ──────────────────────────────────────────────────────────────────
const norm = (s) => (s || '').toLowerCase().replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').trim();
const isAscii = (s) => /^[a-zA-Z0-9\s\d.'\-:!?,&()]+$/.test((s || '').trim());

function bigramSet(s) { const cs = Array.from(s); const p = []; for (let i = 0; i < cs.length - 1; i++) p.push(cs[i] + cs[i + 1]); if (cs.length === 1) p.push(cs[0]); return p; }
function bigramSim(a, b) {
  if (!a || !b) return 0;
  const a0 = norm(a), b0 = norm(b);
  if (!a0 || !b0) return 0;
  if (a0 === b0) return 1;
  const sA = bigramSet(a0), sB = bigramSet(b0);
  let inter = 0;
  for (const x of sA) if (sB.includes(x)) inter++;
  const u = sA.length + sB.length - inter;
  return u === 0 ? 0 : inter / u;
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
}

// ── psql (走 docker exec, 零转义) ─────────────────────────────────────────
function psql(sqlText, input) {
  const r = spawnSync('docker', [
    'exec', '-i', PG_CONTAINER, 'psql', '-U', PG_USER, '-d', PG_DB,
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', sqlText,
  ], { input: input ?? '', encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = (r.stderr || '').trim() || (r.stdout || '').trim() || `exit ${r.status}`;
    throw new Error('psql failed: ' + err.slice(0, 500));
  }
  return (r.stdout || '').trim();
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ── 状态 / 缓存 ───────────────────────────────────────────────────────────
fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const CACHE_FILE = path.join(STATE_DIR, 'title-cache.jsonl');

let state = { afterId: START_ID, processed: 0, matched: 0, written: 0, skipped: 0, failed: 0, startedAt: new Date().toISOString(), tierCount: {} };
if (fs.existsSync(STATE_FILE) && !arg('--fresh', '')) {
  try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch { /* 坏文件就重来 */ }
}
if (START_ID > 0) state.afterId = START_ID;
function saveState() {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// 片名级缓存: key = `${type}|${norm(name)}|${year}` → 结果或 null
let CACHE_ENABLED = true;
const titleCache = new Map();
if (fs.existsSync(CACHE_FILE)) {
  const lines = fs.readFileSync(CACHE_FILE, 'utf8').split('\n');
  for (const ln of lines) {
    if (!ln.trim()) continue;
    try {
      const o = JSON.parse(ln);
      if (o && o.k) titleCache.set(o.k, o.v ?? null);
    } catch { /* 坏行跳过 */ }
  }
  log(`载入片名缓存 ${titleCache.size} 条`);
}
let cacheAppendBuf = [];
function cacheFlush(force) {
  if (!cacheAppendBuf.length) return;
  if (!force && cacheAppendBuf.length < 200) return;
  fs.appendFileSync(CACHE_FILE, cacheAppendBuf.join('\n') + '\n');
  cacheAppendBuf = [];
}
function cachePut(k, v) {
  titleCache.set(k, v);
  if (!CACHE_ENABLED) return;
  cacheAppendBuf.push(JSON.stringify({ k, v }));
  cacheFlush(false);
}

// ── TMDB 限速 ─────────────────────────────────────────────────────────────
let lastCall = 0;
async function throttle() {
  const minGap = Math.max(10, Math.floor(1000 / Math.max(1, RPS)));
  const now = Date.now();
  const w = lastCall + minGap - now;
  if (w > 0) await new Promise(r => setTimeout(r, w));
  lastCall = Date.now();
}

// ── TMDB 搜索 + 打分 ─────────────────────────────────────────────────────
const BAD_STATUS = ['In Production', 'Planned'];
let apiCalls = 0;

async function searchTmdb(query, type, lang, year) {
  if (!query || query.length < 2) return null;
  apiCalls++;
  await throttle();
  // ⚠️ 年份参数会收窄结果 —— 歧义片名靠它区分 (美人鱼 1934 vs 2016)
  const yp = year ? (type === 'tv' ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`) : '';
  const url = `${TMDB_BASE}/search/${type}?query=${encodeURIComponent(query)}` +
    `&api_key=${TMDB_KEYS[Math.floor(Math.random() * TMDB_KEYS.length)]}` +
    `&language=${lang}&page=1&include_adult=false${yp}`;
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  } catch { return { err: 'timeout' }; }
  if (res.status === 429) return { err: '429' };
  if (!res.ok) return null;
  let data;
  try { data = await res.json(); } catch { return null; }
  if (!data.results || !data.results.length) return null;

  const cands = [];
  for (const r of data.results) {
    const st = r.status || (type === 'tv' ? 'Unknown' : (r.release_date ? 'Released' : 'Unknown'));
    if (BAD_STATUS.includes(st)) continue;
    cands.push(r);
    if (cands.length >= 8) break;
  }
  if (!cands.length) return null;

  const cn = norm(query);
  let best = null;
  for (const c of cands) {
    const zh = c.title || c.name || '';
    const en = c.original_title || c.original_name || '';
    const ry = (c.release_date || c.first_air_date || '').slice(0, 4);
    let tier = 'none', score = 0;
    for (const t of [zh, en]) {
      if (!t) continue;
      const tn = norm(t);
      if (!tn) continue;
      if (tn === cn) { tier = 'exact'; score = 100; break; }
      if (tn.startsWith(cn) && cn.length >= 2) { if (score < 90) { tier = 'prefix'; score = 90; } continue; }
      // ⚠️ 短名 (2 字) 的包含匹配要求「长度差 <= 1」
      //   「镖人」→《护镖人》(差 1) ✓ 该匹配; 「火花」→《幽灵火花》(差 2) ✗ 不能匹配
      //   (engine 老规则没有这个限制, 所以会把「动画」→《清华附小语文综合动画课》这种垃圾也认了)
      if (cn.length === 2) {
        if (tn.includes(cn) && tn.length - cn.length <= 1) { if (score < 80) { tier = 'substr'; score = 80; } continue; }
      } else if (cn.length >= 3 && tn.includes(cn)) {
        // 2026-10-29 实测校准: 包含匹配不限长度差
        //   限长度会漏掉: 「吞噬星空」→「吞噬星空2」/「全职法师」→「全职法师 第五季」
        if (score < 80) { tier = 'substr'; score = 80; }
        continue;
      }
      // 反向包含 (片名带序号/副标题): "问心" → 《问心2》 (差值限 8)
      if (tn.length >= 3 && cn.includes(tn) && cn.length - tn.length <= 8) { if (score < 75) { tier = 'substr'; score = 75; } continue; }
      const sim = bigramSim(cn, tn);
      if (sim >= 0.5 && score < 60) { tier = 'bigram'; score = Math.round(sim * 60); continue; }
      if (tn.length >= 2) {
        const d = lev(cn, tn);
        const tol = Math.max(2, Math.floor(Math.max(cn.length, tn.length) * 0.4));
        if (d <= tol && score < 40) { tier = 'fuzzy'; score = Math.round(30 * (1 - d / Math.max(1, Math.max(cn.length, tn.length)))); }
      }
    }
    if (tier === 'none') continue;
    // 年份加权
    if (year && ry) {
      const gap = Math.abs(parseInt(ry) - parseInt(year));
      if (gap <= 1) score += 5;
      else if (gap > 3) score -= 25;
    }
    if (!best || score > best.score) {
      best = {
        score, tier,
        id: String(c.id),
        title: en || zh,                 // xx_tmdb_cache.title = 原名 (not null)
        titleZh: /[\u4e00-\u9fff]/.test(zh) ? zh : '',
        originalTitle: en,
        type,
        poster: c.poster_path || '',
        vote: c.vote_average || 0,
        ry,
        genres: Array.isArray(c.genre_ids) ? c.genre_ids.join(',') : '',
      };
    }
  }
  if (!best || best.score < 30) return null;
  return best;
}

// ── 「其他」分类的快速过滤 (2026-10-29) ───────────────────────────────────
// 这批 12098 条里大部分是书/软件/课程 → 直接拿去找 TMDB 纯浪费配额
// (实测: 软件 ~200 + 课程 ~450 + 书 ~9000, 每条要 3 次调用)
// 命中关键词的 → 直接当 SKIP, 后面由 reclassify-other-v2.cjs 按规则归类
const RE_OTHER_NONFILM = /(免安装|绿色版|破解|破解版|绿色中文版|Setup|Installer|Portable|Repack|课程|教程|教学|讲座|网课|公开课|课件|训练营|真题|试卷|讲义|年级|高考|复习|习题|解锁|去广告|纯净版|专业版|会员版|最新版|注册机|激活码|固件|驱动)/i;
function isObviousNonFilm(category, name) {
  if (category !== '其他') return false;
  return RE_OTHER_NONFILM.test(name || '');
}

// ── 单条匹配 (带缓存) ────────────────────────────────────────────────────
// 2026-10-29 策略 (实测校准):
//   1. 主片名 + 主语言 + 年份 → 命中概率最高 (年份收窄结果, 歧义片名靠它区分)
//   2. 主片名 + 主语言 不带年份 (年份可能是错的)
//   3. 主片名 + 备用语言 (中文名搜不到时用英文名)
//   4. 备用片名 (双语片名的另一半 / 副标题)
// ⚠️ 备用片名只认 exact/prefix —— 副标题/演员名拿去搜极易匹配到别的作品
//   (实测「动画」→「清华附小语文综合动画课」、「动作」→「砵兰街行动」)
async function matchOne(name, category, subType) {
  if (isObviousNonFilm(category, name)) return null;
  const c = cleanFolderName(name);
  if (!c.cleanName || c.cleanName.length < 2) return null;
  const types = typesFor(category, subType, c.season);
  if (!types) return null;

  const names = [...new Set([c.cleanName, ...(c.alts || [])].filter(x => x && x.length >= 2))].slice(0, 3);
  for (let ni = 0; ni < names.length; ni++) {
    const nm = names[ni];
    const isAlt = ni > 0;
    const cn = norm(nm);
    for (const type of types) {
      const key = `${type}|${cn}|${c.year || ''}`;
      if (CACHE_ENABLED && titleCache.has(key)) {
        const cached = titleCache.get(key);
        if (cached && (!isAlt || cached.tier === 'exact' || cached.tier === 'prefix')) {
          return { ...cached, usedName: nm, fromCache: true };
        }
        continue;  // 缓存里是 null → 这个 (片名,类型) 查过没有, 换下一个
      }
      const langs = isAscii(nm) ? ['en-US', 'zh-CN'] : ['zh-CN', 'en-US'];
      let best = null;
      const tries = [];
      if (c.year) tries.push([langs[0], c.year]);
      tries.push([langs[0], null], [langs[1], null]);
      for (const [lang, yr] of tries) {
        const r = await searchTmdb(nm, type, lang, yr);
        if (r && r.err === '429') {
          await new Promise(res => setTimeout(res, 8000));
          const r2 = await searchTmdb(nm, type, lang, yr);
          if (r2 && !r2.err && r2) { if (!best || r2.score > best.score) best = r2; if (best.tier === 'exact' || best.tier === 'prefix') break; }
          continue;
        }
        if (!r || r.err) continue;
        if (!best || r.score > best.score) best = r;
        // 高置信直接收工; 不够好就继续试下一个语言/年份组合
        // ⚠️ 2026-10-29 实测: 老写法"拿到任何结果就 break" → 后面 2 个策略白试了
        //   engine 能多命中 65/120 就是因为它会一直试到 confidence >= 0.5
        if (r.tier === 'exact' || r.tier === 'prefix') break;
      }
      cachePut(key, best);
      if (!best) continue;
      const ok = best.tier === 'exact' || best.tier === 'prefix'
        || (!isAlt && (best.tier === 'substr' || (ALLOW_FUZZY && (best.tier === 'bigram' || best.tier === 'fuzzy'))));
      if (ok) return { ...best, usedName: nm };
    }
  }
  return null;
}

// ── DB: 取一批 ───────────────────────────────────────────────────────────
// ⚠️ 2026-10-29 实测: 必须同时捞 tmdb_id IS NULL 的行!
//   「其他」分类 12098 条从来没进过 NOMATCH 集合 (老 cron 只给 NULL 行写 'NOMATCH',
//   而这批从没被 cron 处理过 → tmdb_id 一直是 NULL) → 只查 NOMATCH 会一条都捞不到
//   (实测: --cats 其他 跑起来 "没有更多数据了", 因为那批全是 NULL)
function fetchChunk(afterId, limit) {
  const catFilter = CATS.length ? `AND category IN (${CATS.map(c => `'${c.replace(/'/g, "''")}'`).join(',')})` : '';
  // ⚠️ matched_tmdb_at 守卫: 跳过最近被处理过的行
  //   - cron match-task 每 5 分钟跑 200 条, 不加守卫会跟 worker 抢同一批行 (浪费 TMDB 配额)
  //   - 另一个 worker 实例刚跑完的行也不用重跑
  //   - 代价: 失败的行要等 6 小时才会被重试 (可接受, 每天多试一轮)
  const ageGuard = MIN_AGE_HOURS > 0
    ? `AND (matched_tmdb_at IS NULL OR matched_tmdb_at < NOW() - INTERVAL '${MIN_AGE_HOURS} hours')`
    : '';
  const sql = `SELECT row_to_json(t)::text FROM (
    SELECT id, name, category, COALESCE(sub_type,'') AS sub_type
    FROM xx_resources
    WHERE status='active'
      AND (tmdb_id IS NULL OR tmdb_id = 'NOMATCH')
      AND id > ${afterId}
      ${ageGuard}
      ${catFilter}
    ORDER BY id LIMIT ${limit}
  ) t`;
  const out = psql(sql);
  const rows = [];
  for (const ln of out.split('\n')) {
    const s = ln.trim();
    if (!s || !s.startsWith('{')) continue;
    try { rows.push(JSON.parse(s)); } catch { /* 跳过 */ }
  }
  return rows;
}

// ── DB: 写回 (staging + COPY) ───────────────────────────────────────────
function ensureStage() {
  psql(`CREATE TABLE IF NOT EXISTS xx_rematch_stage (
    rid bigint, tid text, ttype text, ttitle text, tzh text, tposter text,
    tvote text, tryear text, tier text, orig text, genres text
  )`);
  // 老版本建表没有 genres 列 → 补上 (IF NOT EXISTS 不管已有表)
  try { psql(`ALTER TABLE xx_rematch_stage ADD COLUMN IF NOT EXISTS genres text`); } catch { /* 忽略 */ }
}

function writeBack(records) {
  if (!records.length) return { updated: 0 };
  ensureStage();
  const csv = records.map(r => [
    r.id, r.tid, r.ttype, r.ttitle, r.tzh, r.tposter, r.tvote, r.tryear, r.tier, r.orig, r.genres || '',
  ].map(csvCell).join(',')).join('\n');
  psql(`COPY xx_rematch_stage (rid,tid,ttype,ttitle,tzh,tposter,tvote,tryear,tier,orig,genres) FROM STDIN WITH CSV`, csv + '\n');
  const out = psql(`
    WITH upd AS (
      UPDATE xx_resources r SET
        tmdb_id = s.tid,
        tmdb_type = s.ttype,
        tmdb_title = COALESCE(NULLIF(s.ttitle,''), r.tmdb_title),
        tmdb_year = COALESCE(NULLIF(s.tryear,'')::int, r.tmdb_year),
        poster = COALESCE(NULLIF(s.tposter,''), r.poster),
        vote_average = COALESCE(NULLIF(s.tvote,'')::numeric, r.vote_average),
        matched_tmdb_at = NOW(),
        updated_at = NOW()
      FROM xx_rematch_stage s
      WHERE r.id = s.rid AND (r.tmdb_id IS NULL OR r.tmdb_id = 'NOMATCH')
      RETURNING r.id
    )
    SELECT count(*) FROM upd
  `);
  const updated = parseInt(out || '0', 10) || 0;

  // 缓存表 (海报走 LEFT JOIN xx_tmdb_cache → 不写这里就没有封面)
  // genres 一起写 → 后面能用 genre_ids=16 (Animation) 判断是不是动漫 (分类重整要用)
  psql(`
    INSERT INTO xx_tmdb_cache (tmdb_id, title, title_zh, tmdb_type, original_title, poster_path, release_date, vote_average, genres, cached_at, expires_at)
    SELECT DISTINCT ON (tid) tid, ttitle, tzh, ttype, orig, tposter, tryear, tvote,
           CASE WHEN genres ~ '^[0-9,]*$' AND genres <> '' THEN string_to_array(genres, ',') ELSE NULL END,
           NOW(), NOW() + INTERVAL '35 days'
    FROM xx_rematch_stage WHERE tid IS NOT NULL AND tid <> ''
    ORDER BY tid
    ON CONFLICT (tmdb_id) DO UPDATE SET
      title = COALESCE(NULLIF(EXCLUDED.title,''), xx_tmdb_cache.title),
      title_zh = COALESCE(NULLIF(EXCLUDED.title_zh,''), xx_tmdb_cache.title_zh),
      original_title = COALESCE(NULLIF(EXCLUDED.original_title,''), xx_tmdb_cache.original_title),
      poster_path = COALESCE(NULLIF(EXCLUDED.poster_path,''), xx_tmdb_cache.poster_path),
      release_date = COALESCE(NULLIF(EXCLUDED.release_date,''), xx_tmdb_cache.release_date),
      vote_average = COALESCE(NULLIF(EXCLUDED.vote_average,''), xx_tmdb_cache.vote_average),
      genres = COALESCE(EXCLUDED.genres, xx_tmdb_cache.genres),
      expires_at = GREATEST(xx_tmdb_cache.expires_at, EXCLUDED.expires_at),
      cached_at = NOW()
  `);
  psql(`DELETE FROM xx_rematch_stage`);
  // 审计日志: 每条写库的记录落一行 JSONL (id/tmdb_id/tier/片名)
  //   → 万一规则放太宽导致错配, 可以按 id 精确回滚 (把 tmdb_id 改回 NOMATCH)
  try {
    fs.appendFileSync(path.join(STATE_DIR, 'written.jsonl'),
      records.map(r => JSON.stringify({ id: r.id, tid: r.tid, t: r.ttype, tier: r.tier, n: r.ttitle })).join('\n') + '\n');
  } catch { /* 审计日志失败不阻塞 */ }
  return { updated };
}

// 失败/跳过的行也落一个哨兵值 (跟 cron 一致):
//   SKIP    = 不该用 TMDB 匹配的分类 (软件/音乐/电子书/...)
//   NOMATCH = 试过了没匹配上
// ⚠️ 这两个都是"哨兵值", search 路由的 count 必须当成"没有 tmdb_id"处理
//   (2026-10-29 已修: 只排 NOMATCH 会漏掉 SKIP/GARBLED → 少算 7389 条)
function markSentinel(groups) {
  let n = 0;
  for (const [sentinel, ids] of Object.entries(groups)) {
    if (!ids.length) continue;
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500).map(x => Number(x)).filter(x => Number.isFinite(x));
      if (!part.length) continue;
      const arr = 'ARRAY[' + part.join(',') + ']';
      psql(`UPDATE xx_resources SET tmdb_id = '${sentinel}', matched_tmdb_at = NOW(), updated_at = NOW()
            WHERE id = ANY(${arr}) AND (tmdb_id IS NULL OR tmdb_id = 'NOMATCH')`);
      n += part.length;
    }
  }
  return n;
}

// ── 主循环 ────────────────────────────────────────────────────────────────
async function main() {
  log('=== 启动 ===');
  log(`state-dir=${STATE_DIR} chunk=${CHUNK} conc=${CONC} rps=${RPS} cats=${CATS.join(',') || '(全部)'} dry=${DRY} fuzzy=${ALLOW_FUZZY}`);
  log(`起点 afterId=${state.afterId} 累计处理=${state.processed} 累计写库=${state.written}`);

  const t0 = Date.now();
  let batchNo = 0;
  const MAX_SECONDS = parseInt(arg('--max-seconds', '0'), 10);
  while (true) {
    if (MAX_ROWS && state.processed >= MAX_ROWS) { log('达到 --max-rows 上限, 退出'); break; }
    // ⚠️ 2026-10-29 修: max-seconds 默认 0 = 不限, 原来 `Date.now()-t0 > 0` 永远成立 → 第一批就跑完退出
    if (MAX_SECONDS > 0 && Date.now() - t0 > MAX_SECONDS * 1000) { log('达到 --max-seconds 上限, 退出'); break; }

    const rows = fetchChunk(state.afterId, CHUNK);
    if (!rows.length) { log('没有更多数据了, 正常结束'); break; }

    batchNo++;
    const bt = Date.now();
    const hits = [];
    const sentinelRows = { SKIP: [], NOMATCH: [] };
    let skipped = 0, failed = 0;

    for (let i = 0; i < rows.length; i += CONC) {
      const slice = rows.slice(i, i + CONC);
      const out = await Promise.all(slice.map(async (r) => {
        try {
          const m = await matchOne(r.name, r.category, r.sub_type);
          return { r, m };
        } catch { return { r, m: null }; }
      }));
      for (const o of out) {
        if (o.m) hits.push(o);
        else if (typesFor(o.r.category, o.r.sub_type || null, null) === null || isObviousNonFilm(o.r.category, o.r.name)) {
          skipped++; sentinelRows.SKIP.push(o.r.id);
        }
        else { failed++; sentinelRows.NOMATCH.push(o.r.id); }
      }
      if (Date.now() - bt > STOP_AFTER_MS) break;   // 单批别跑太久
    }

    const maxId = rows[rows.length - 1].id;
    state.afterId = maxId;
    state.processed += rows.length;
    state.skipped += skipped;
    state.failed += failed;

    const tierCount = {};
    for (const h of hits) tierCount[h.m.tier] = (tierCount[h.m.tier] || 0) + 1;
    for (const t of Object.keys(tierCount)) state.tierCount[t] = (state.tierCount[t] || 0) + tierCount[t];

    if (!DRY) {
      if (hits.length) {
        const recs = hits.filter(h => ALLOW_FUZZY || h.m.tier === 'exact' || h.m.tier === 'prefix' || h.m.tier === 'substr')
          .map(h => ({
            id: h.r.id, tid: h.m.id, ttype: h.m.type,
            ttitle: h.m.title, tzh: h.m.titleZh, tposter: h.m.poster,
            tvote: h.m.vote ? String(h.m.vote) : '', tryear: h.m.ry || '',
            tier: h.m.tier, orig: h.m.originalTitle || '',
            genres: h.m.genres || '',
          }));
        try {
          const w = writeBack(recs);
          state.written += w.updated;
          state.matched += hits.length;
        } catch (e) {
          log('写库失败:', e.message);
        }
      } else {
        state.matched += hits.length;
      }
      // 没匹配上的行也落哨兵值 (SKIP / NOMATCH), 让这批不再被反复重试
      try {
        const n = markSentinel(sentinelRows);
        state.sentinel = (state.sentinel || 0) + n;
      } catch (e) {
        log('哨兵写入失败:', e.message);
      }
    } else {
      state.matched += hits.length;
    }

    cacheFlush(false);
    saveState();

    const el = ((Date.now() - bt) / 1000).toFixed(1);
    log(`批#${batchNo} 取${rows.length} 命中${hits.length}(${tierCount.exact || 0}e/${tierCount.prefix || 0}p/${tierCount.substr || 0}s/${tierCount.bigram || 0}b/${tierCount.fuzzy || 0}f) 跳过${skipped} 未匹配${failed} | ${el}s | afterId=${maxId} | 累计处理${state.processed} 写库${state.written}`);

    // 打印命中样例 (前 5 条)
    hits.slice(0, 5).forEach(h => log(`   [${h.m.tier}] ${String(h.r.name).replace(/\n/g, ' ').slice(0, 40)} → ${h.m.type} ${h.m.id} 《${h.m.title}》${h.m.titleZh ? ' / ' + h.m.titleZh : ''}`));

    if (Date.now() - bt > STOP_AFTER_MS && rows.length < CHUNK) break;
  }

  cacheFlush(true);
  saveState();
  log(`=== 结束: 处理 ${state.processed} 命中 ${state.matched} 写库 ${state.written} 跳过 ${state.skipped} 未匹配 ${state.failed} ===`);
  log(`tier 分布: ${JSON.stringify(state.tierCount)}`);
}

// 被 require 时只导出函数, 不跑主循环 (测试脚本要用)
module.exports = {
  matchOne, typesFor, searchTmdb, cleanFolderName,
  norm, bigramSim, lev, psql, fetchChunk, writeBack,
  setRps: (v) => { RPS = v; },
  clearCache: () => { titleCache.clear(); cacheAppendBuf = []; },
  getStats: () => ({ apiCalls, cacheSize: titleCache.size }),
  setCacheEnabled: (v) => { CACHE_ENABLED = v; },
};

if (require.main === module) {
  main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
}
