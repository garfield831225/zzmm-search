// 批量重跑 NOMATCH 匹配 (2026-10-29)
// 背景: cron match-task 只查 tmdb_id IS NULL → 32 万条 NOMATCH 永远不会被重新匹配
//       引擎修好后必须能重跑, 否则新引擎对存量数据无效
//
// 用法: node scripts/rematch-nomatch.cjs [--size 2000] [--batch 1] [--cats a,b] [--dry]
//   --size   每批条数 (默认 2000)
//   --batch  第几批 (从 1 开始, 可反复调用续跑)
//   --cats   只跑指定分类 (逗号分隔, 默认跑全部可匹配分类)
//   --dry    只匹配不写库
//
// 流程: NAS psql 拉一批 → 本地 TMDB 匹配 → 生成 UPDATE SQL → 送回 NAS 执行
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.tmp-rematch');
fs.mkdirSync(TMP, { recursive: true });

// 依赖解析: 项目 node_modules 没有 ssh2, 回退到 C:\temp_zzmm\node_modules
function req(name) {
  const paths = [
    path.join(ROOT, 'node_modules', name),
    path.join('C:\\temp_zzmm', 'node_modules', name),
    name,
  ];
  for (const p of paths) { try { return require(p); } catch (e) { /* next */ } }
  throw new Error('找不到模块 ' + name);
}
const esbuild = req('esbuild');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SIZE = parseInt(arg('--size', '2000'), 10);
const BATCH = parseInt(arg('--batch', '1'), 10);
const CATS = arg('--cats', '');
const DRY = args.includes('--dry');

const NAS = { host: '192.168.3.8', port: 10000, user: '13381064903', pass: process.env.NAS_PASS || '@G831225dd' };
const TMDB_KEYS = ['7985342d5961e9ee3d5ef6d969c1b8dd', '79e41efe870e60afb09b9de8baa47cf1'];
const TMDB_BASE = 'https://api.themoviedb.org/3';

// ── SSH (ssh2): 项目 node_modules 没有, 回退到 C:\temp_zzmm\node_modules ──
const { Client } = req('ssh2');
function sshRun(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '', stderr = '';
      stream.on('data', (c) => { stdout += c.toString(); });
      stream.stderr.on('data', (c) => { stderr += c.toString(); });
      stream.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  });
}

// ── 加载新提取器 ──
const ctOut = esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src', 'lib', 'clean-title.ts')],
  bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node18',
});
const ctMod = { exports: {} };
new Function('module', 'exports', 'require', ctOut.outputFiles[0].text)(ctMod, ctMod.exports, require);
const cleanFolderName = ctMod.exports.cleanFolderName;

// ── 分类策略 (跟 lib/match-engine 的 getTypesForCategory 一致) ──
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
  if (category === '原盘') return (['电影', '动画电影', '演唱会', '3D原盘'].includes(subType || '')) ? ['movie'] : ['tv'];
  if (MOVIE_ONLY.has(category)) return ['movie'];
  if (subType && ['剧集', '韩剧', '欧美剧', '港台剧', '国产剧', '日剧', '动漫', '动画', '综艺', '纪录片', '少儿', '演唱会', '连载', '短剧', '微短剧'].some((t) => subType.includes(t))) return ['tv'];
  return ['movie', 'tv'];
}

// ── TMDB ──
let lastCall = 0;
const MIN_GAP = 45;
async function throttle() {
  const now = Date.now();
  const w = lastCall + MIN_GAP - now;
  if (w > 0) await new Promise((r) => setTimeout(r, w));
  lastCall = Date.now();
}
const norm = (s) => s.toLowerCase().replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').trim();
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
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
  }
  return dp[m][n];
}
const BAD = { tv: ['In Production', 'Planned'], movie: ['In Production', 'Planned'] };
async function searchTmdb(name, type, lang, year) {
  if (!name || name.length < 2) return null;
  await throttle();
  const ep = type === 'tv' ? '/search/tv' : '/search/movie';
  const yp = year ? (type === 'tv' ? `&first_air_date_year=${year}` : `&year=${year}`) : '';
  const url = `${TMDB_BASE}${ep}?query=${encodeURIComponent(name)}&api_key=${TMDB_KEYS[Math.floor(Math.random() * 2)]}&language=${lang}&page=1&include_adult=false${yp}`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    let cands = [];
    for (const r of data.results) {
      const st = r.status || (type === 'tv' ? 'Unknown' : (r.release_date ? 'Released' : 'Unknown'));
      if ((BAD[type] || []).includes(st)) continue;
      cands.push(r);
      if (cands.length >= 8) break;
    }
    if (!cands.length) return null;
    if (year && cands.length > 1) {
      const f = cands.filter((c) => {
        const ry = (c.release_date || c.first_air_date || '').slice(0, 4);
        return !ry || Math.abs(parseInt(ry) - parseInt(year)) <= 2;
      });
      if (f.length) cands = f;
    }
    const cn = norm(name);
    // ⚠️ 返回命中的 tier, 供写库时分级 (1:1/prefix = 高置信, sub/bigram/lev = 模糊)
    const pick = (c, tier) => {
      const zh = c.title || c.name || '';
      const en = c.original_title || '';
      return {
        id: String(c.id),
        title: en || zh,                       // xx_tmdb_cache.title = 原名 (not null)
        titleZh: /[\u4e00-\u9fff]/.test(zh) ? zh : '',   // title_zh = 中文名
        type,
        poster: c.poster_path || '',
        vote: c.vote_average || 0,
        ry: (c.release_date || c.first_air_date || '').slice(0, 4),
        tier,
      };
    };
    // tier 顺序: exact → prefix → sub → bigram → lev
    //   prefix 比 sub 精确 (前缀匹配不会匹配到"幕后特辑"这种副标题)
    //   例「龙之家族 第三季」不该匹配到《龙之家族：幕后特辑》—— prefix 不成立, sub 才成立
    for (const c of cands) { const t = c.title || c.name || ''; if (t && norm(t) === cn && cn.length) return pick(c, 'exact'); }
    for (const c of cands) { const t = c.title || c.name || ''; const tn = norm(t); if (tn.startsWith(cn) && cn.length >= 2) return pick(c, 'prefix'); }
    // ⚠️ 短名 (<3 字) 禁用子串匹配 —— "火花" 会匹配到《幽灵火花》这种同类型不同作品
    if (cn.length >= 3) {
      for (const c of cands) { const t = c.title || c.name || ''; const tn = norm(t); if (tn.includes(cn) && cn.length >= 3 && tn.length - cn.length <= 6) return pick(c, 'substr'); }
    }
    for (const c of cands) { const t = c.title || c.name || ''; if (bigramSim(cn, norm(t)) >= 0.5) return pick(c, 'bigram'); }
    for (const c of cands) {
      const t = c.title || c.name || ''; const tn = norm(t);
      if (tn.length < 2) continue;
      if (lev(cn, tn) <= Math.max(2, Math.floor(Math.max(cn.length, tn.length) * 0.4))) return pick(c, 'fuzzy');
    }
    return null;
  } catch { return null; }
}
const STRAT_ZH = [{ lang: 'zh-CN', y: true }, { lang: 'zh-CN', y: false }, { lang: 'en-US', y: true }];
const STRAT_EN = [{ lang: 'en-US', y: true }, { lang: 'en-US', y: false }, { lang: 'zh-CN', y: true }];
const isEng = (s) => /^[a-zA-Z\s\d.'-]+$/.test((s || '').trim());

async function matchOne(name, category, subType) {
  const c = cleanFolderName(name);
  if (!c.cleanName || c.cleanName.length < 2) return null;
  const types = typesFor(category, subType, c.season);
  if (!types) return null;
  const names = [...new Set([c.cleanName, ...(c.alts || [])].filter((x) => x && x.length >= 2))].slice(0, 3);
  let calls = 0;
  for (const nm of names) {
    const strats = isEng(nm) ? STRAT_EN : STRAT_ZH;
    for (const s of strats) {
      for (const t of types) {
        if (calls >= 8) return null;
        calls++;
        const r = await searchTmdb(nm, t, s.lang, s.y ? c.year : undefined);
        if (r) return { ...r, usedName: nm };
      }
    }
  }
  return null;
}

// ── CSV ──
function parseCsv(text) {
  const rows = []; let cur = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { cur.push(f); f = ''; }
    else if (ch === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; }
    else if (ch !== '\r') f += ch;
  }
  if (f.length || cur.length) { cur.push(f); rows.push(cur); }
  return rows;
}

(async () => {
  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res); conn.on('error', rej);
    conn.connect({ host: NAS.host, port: NAS.port, username: NAS.user, password: NAS.pass, readyTimeout: 30000,
      algorithms: { kex: ['curve25519-sha256', 'diffie-hellman-group14-sha1'] } });
  });

  // ── 1. 拉一批 ──
  const OFFSET = (BATCH - 1) * SIZE;
  const catFilter = CATS ? CATS.split(',').map((x) => `'${x.trim()}'`).join(',') : '';
  const sql = `SELECT id::text, name, category, COALESCE(sub_type,'') FROM xx_resources
    WHERE status='active' AND tmdb_id='NOMATCH'
    ${catFilter ? `AND category IN (${catFilter})` : ''}
    ORDER BY id LIMIT ${SIZE} OFFSET ${OFFSET}`;
  // ⚠️ 必须用 -f /dev/stdin (文件), 不能用 -c "..." —— shell 会吃掉 SQL 里的单引号
  //   (tmdb_id='NOMATCH' → tmdb_id=NOMATCH → column "nomatch" does not exist)
  // ⚠️ \copy 是 psql 元命令, 必须压成一行 (跨行会 parse error)
  const copySql = `\\copy (${sql.replace(/\s+/g, ' ')}) TO STDOUT WITH CSV HEADER`;
  const psql = `echo "${Buffer.from(copySql, 'utf8').toString('base64')}" | base64 -d > /tmp/_rm.sql
echo "${NAS.pass}" | sudo -S -p "" bash -c "docker exec -i postgresql psql -U hyperms -d zzmm_search -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/_rm.sql" 2>&1`;
  console.log(`=== 拉取第 ${BATCH} 批 (offset ${OFFSET}, ${SIZE} 条) ===`);
  const pull = await sshRun(conn, psql);
  if (process.env.RM_DEBUG) console.log('[raw stdout]', JSON.stringify(pull.stdout.slice(0, 500)));
  const rows = parseCsv(pull.stdout).slice(1);
  console.log(`拉到 ${rows.length} 条`);
  if (!rows.length) { console.log('没有更多数据了'); conn.end(); return; }

  // ── 2. 匹配 (并发 20) ──
  const CONC = 20;
  const hits = [];
  let matched = 0, skipped = 0, failed = 0;
  const tierCount = { exact: 0, substr: 0, prefix: 0, bigram: 0, fuzzy: 0 };
  for (let i = 0; i < rows.length; i += CONC) {
    const slice = rows.slice(i, i + CONC);
    const out = await Promise.all(slice.map(async ([id, name, category, subType]) => {
      try {
        const r = await matchOne(name, category, subType || null);
        return { id, name, category, r };
      } catch { return { id, name, category, r: null }; }
    }));
    for (const o of out) {
      if (o.r) { matched++; tierCount[o.r.tier] = (tierCount[o.r.tier] || 0) + 1; hits.push(o); }
      else if (typesFor(o.category, null, null) === null) skipped++;
      else failed++;
    }
    process.stdout.write(`\r  ${Math.min(i + CONC, rows.length)}/${rows.length}  命中 ${matched} 跳过 ${skipped} 未匹配 ${failed}   `);
  }
  console.log(`\n\n=== 匹配结果 ===`);
  console.log(`  命中 ${matched} / ${rows.length} (${(100 * matched / rows.length).toFixed(1)}%)`);
  console.log(`  跳过(不该匹配TMDB的分类) ${skipped} | 未匹配 ${failed}`);
  console.log(`  置信度分级: ${JSON.stringify(tierCount)}`);
  console.log(`  (exact/substr/prefix = 高置信可直接写库; bigram/fuzzy = 模糊, 需人工确认)`);

  if (!hits.length) { console.log('本批无命中, 不写库'); conn.end(); return; }

  // ── 3. 写回 ──
  if (DRY) {
    console.log('\n(--dry) 命中的前 20 条:');
    hits.slice(0, 20).forEach((h) => console.log(`  [${h.r.tier}] ${h.name.replace(/\n/g, ' ').slice(0, 44)} → ${h.r.usedName} → TMDB ${h.r.id} 《${h.r.title}》`));
    conn.end();
    return;
  }

  // ── 3.1 置信度门槛: 只写高置信 (exact/substr/prefix) ──
  //   bigram/fuzzy 是模糊匹配, 可能配到同类型的另一部作品 → 先不写, 只统计
  //   (要写的话加 --allow-fuzzy)
  const HIGH_CONF = new Set(['exact', 'substr', 'prefix']);
  const ALLOW_FUZZY = args.includes('--allow-fuzzy');
  const toWrite = hits.filter((h) => ALLOW_FUZZY || HIGH_CONF.has(h.r.tier));
  const fuzzySkipped = hits.length - toWrite.length;
  console.log(`\n=== 写回 ${toWrite.length} 条 (模糊 ${fuzzySkipped} 条跳过${ALLOW_FUZZY ? '' : ', 加 --allow-fuzzy 可写入'}) ===`);
  if (!toWrite.length) { console.log('没有高置信命中, 不写库'); conn.end(); return; }

  // 生成 UPDATE (VALUES 批量)
  const vals = toWrite.map((h) => `(${h.id},'${h.r.id}','${h.r.type}','${String(h.r.title || '').replace(/'/g, "''")}','${String(h.r.poster || '').replace(/'/g, "''")}')`).join(',');
  const upd = `UPDATE xx_resources r SET
  tmdb_id = v.tid,
  type = v.ttype,
  matched_tmdb_at = NOW()
FROM (VALUES ${vals}) AS v(id, tid, ttype, ttitle, tposter)
WHERE r.id = v.id::bigint AND r.tmdb_id = 'NOMATCH';`;
  const updB64 = Buffer.from(upd, 'utf8').toString('base64');
  console.log(`\n=== 写回 ${hits.length} 条 ===`);
  const wr = await sshRun(conn, [
    `echo "${updB64}" | base64 -d > /tmp/_rm_upd.sql`,
    `echo "${NAS.pass}" | sudo -S -p "" bash -c "docker exec -i postgresql psql -U hyperms -d zzmm_search -v ON_ERROR_STOP=1 < /tmp/_rm_upd.sql" 2>&1 | tail -3`,
  ].join('\n'));
  console.log(wr.stdout.trim());

  // 顺便更新 xx_tmdb_cache (让搜索/封面能拿到)
  // ⚠️ xx_tmdb_cache.title 是 not null (原名), title_zh 才是中文名 —— 列名给错会整条插入失败
  const cacheVals = toWrite.map((h) => `('${h.r.id}','${String(h.r.title || '').replace(/'/g, "''")}','${String(h.r.titleZh || '').replace(/'/g, "''")}','${h.r.type}','${String(h.r.poster || '').replace(/'/g, "''")}','${h.r.ry || ''}','${String(h.r.vote || 0)}')`).join(',');
  if (cacheVals) {
    const cacheSql = `INSERT INTO xx_tmdb_cache (tmdb_id, title, title_zh, tmdb_type, poster_path, release_date, vote_average)
VALUES ${cacheVals}
ON CONFLICT (tmdb_id) DO UPDATE SET
  title = COALESCE(NULLIF(EXCLUDED.title,''), xx_tmdb_cache.title),
  title_zh = COALESCE(NULLIF(EXCLUDED.title_zh,''), xx_tmdb_cache.title_zh),
  poster_path = COALESCE(NULLIF(EXCLUDED.poster_path,''), xx_tmdb_cache.poster_path),
  release_date = COALESCE(NULLIF(EXCLUDED.release_date,''), xx_tmdb_cache.release_date),
  vote_average = COALESCE(NULLIF(EXCLUDED.vote_average,''), xx_tmdb_cache.vote_average);`;
    const cB64 = Buffer.from(cacheSql, 'utf8').toString('base64');
    const cw = await sshRun(conn, [
      `echo "${cB64}" | base64 -d > /tmp/_rm_cache.sql`,
      `echo "${NAS.pass}" | sudo -S -p "" bash -c "docker exec -i postgresql psql -U hyperms -d zzmm_search -v ON_ERROR_STOP=1 < /tmp/_rm_cache.sql" 2>&1 | tail -2`,
    ].join('\n'));
    console.log('[tmdb_cache]', cw.stdout.trim());
  }

  console.log('\n命中的前 20 条:');
  toWrite.slice(0, 20).forEach((h) => console.log(`  [${h.r.tier}] ${h.name.replace(/\n/g, ' ').slice(0, 42)} → TMDB ${h.r.id} 《${h.r.title}》`));
  conn.end();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
