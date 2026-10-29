#!/usr/bin/env node
// ============================================================================
// TMDB cache 过期续期 worker (2026-10-29, C 批次)
// ----------------------------------------------------------------------------
// 为什么:
//   实测 xx_tmdb_cache 31217 行里 20954 行已过期 (35 天 TTL),
//   其中 19910 行 **poster_path 还在** —— 数据没丢, 只是 expires_at 过期
//   → search/route.ts 的 `expires_at > NOW()` 过滤把这些海报全丢掉 → 66233 条资源受害
//
//   A1 批次已经让前端能读到过期行的海报 (SQL 层不过期 JOIN),
//   但**元数据** (评分/简介/上映日期) 还是旧的 → 这个 worker 负责把它们刷新鲜
//
// 做什么:
//   把 expires_at <= now() 的 cache 行重新拉一次 TMDB 详情, 覆盖元数据 + 续 expires_at
//   拉不到的 (TMDB 下架/404) → 只续 expires_at, 保留已有 poster_path (海报 URL 稳定)
//
// 用法 (NAS 上):
//   node cache-refresh-worker.cjs --state-dir /data_s001/docker/zzmm-search/.cache-refresh \
//        --rps 5 --conc 3
//   --max-rows N     本次最多刷新 N 条 (0 = 不限)
//   --max-seconds N  本次最长运行秒数 (0 = 不限)
//   --dry            只拉不写
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ARGS = process.argv.slice(2);
const arg = (k, d) => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : d; };
const has = (k) => ARGS.includes(k);

const STATE_DIR = arg('--state-dir', '/data_s001/docker/zzmm-search/.cache-refresh');
const CHUNK = parseInt(arg('--chunk', '200'), 10);
const CONC = parseInt(arg('--conc', '3'), 10);
let RPS = parseFloat(arg('--rps', '5'));
const MAX_ROWS = parseInt(arg('--max-rows', '0'), 10);
const MAX_SECONDS = parseInt(arg('--max-seconds', '0'), 10);  // 0 = 不限
const DRY = has('--dry');
const ONLY_WITH_POSTTER = !has('--all');

const TMDB_KEYS = ['7985342d5961e9ee3d5ef6d969c1b8dd', '79e41efe870e60afb09b9de8baa47cf1'];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const PG_CONTAINER = 'postgresql';
const PG_USER = 'hyperms';
const PG_DB = 'zzmm_search';

function log(...a) {
  console.log(`[${new Date().toISOString()}] ${a.join(' ')}`);
}

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

// ── 状态文件 ───────────────────────────────────────────────────────────────
fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch { return {}; }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ── 限流 ───────────────────────────────────────────────────────────────────
let lastCall = 0;
async function throttle() {
  const minGap = 1000 / Math.max(0.1, RPS);
  const now = Date.now();
  const wait = Math.max(0, lastCall + minGap - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

// ── 拉 TMDB 详情 ──────────────────────────────────────────────────────────
async function fetchDetail(tmdbId, type) {
  await throttle();
  const key = TMDB_KEYS[Math.floor(Math.random() * TMDB_KEYS.length)];
  const url = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${key}&language=zh-CN`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (res.status === 429) return { err: '429' };
    if (!res.ok) return { err: `http_${res.status}` };
    const d = await res.json();
    const release = d.release_date || d.first_air_date || null;
    const genres = Array.isArray(d.genres) ? d.genres.map((g) => g.id).join(',') : '';
    const countries = Array.isArray(d.origin_country) ? d.origin_country.join(',')
      : (d.production_countries || []).map((c) => c.iso_3166_1).filter(Boolean).join(',');
    return {
      id: String(d.id),
      title: d.title || d.name || '',           // xx_tmdb_cache.title = 原名 (not null)
      titleZh: d.title || d.name || '',
      originalTitle: d.original_title || d.original_name || '',
      poster: d.poster_path || '',
      backdrop: d.backdrop_path || '',
      overview: d.overview || '',
      releaseDate: release || '',
      voteAvg: d.vote_average != null ? String(d.vote_average) : '',
      voteCnt: d.vote_count != null ? String(d.vote_count) : '',
      status: d.status || '',
      tagline: d.tagline || '',
      genres,
      countries,
      type,
    };
  } catch (e) {
    return { err: (e && e.message) || 'fetch_failed' };
  }
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
(async () => {
  const state = loadState();
  const t0 = Date.now();
  let processed = state.processed || 0;
  let refreshed = state.refreshed || 0;
  let failed = state.failed || 0;
  let notFound = state.notFound || 0;

  log('=== 开始: TMDB cache 过期续期 ===');
  log(`state-dir=${STATE_DIR} conc=${CONC} rps=${RPS} chunk=${CHUNK} dry=${DRY} onlyWithPoster=${ONLY_WITH_POSTTER}`);

  while (true) {
    if (MAX_SECONDS > 0 && (Date.now() - t0) / 1000 > MAX_SECONDS) {
      log('达到 --max-seconds 上限, 退出');
      break;
    }
    if (MAX_ROWS > 0 && processed >= MAX_ROWS) {
      log('达到 --max-rows 上限, 退出');
      break;
    }

    // 取一批过期的 cache 行
    const posterFilter = ONLY_WITH_POSTTER
      ? `AND poster_path IS NOT NULL AND trim(poster_path) <> ''`
      : '';
    const out = psql(`
      SELECT tmdb_id || E'\\t' || COALESCE(tmdb_type,'movie')
      FROM xx_tmdb_cache
      WHERE expires_at <= NOW() ${posterFilter}
      ORDER BY expires_at ASC
      LIMIT ${CHUNK}
    `);
    const rows = (out || '').split('\n').map(s => s.trim()).filter(Boolean)
      .map(line => {
        const [id, type] = line.split('\t');
        return { id: id.trim(), type: (type || 'movie').trim() };
      })
      .filter(r => /^[0-9]{1,10}$/.test(r.id) && parseInt(r.id) > 10000);

    if (rows.length === 0) {
      log('没有更多过期行, 结束');
      break;
    }

    // 并发拉详情
    let idx = 0;
    const workers = Array.from({ length: Math.min(CONC, rows.length) }, async () => {
      while (idx < rows.length) {
        const i = idx++;
        const r = rows[i];
        processed++;
        const info = await fetchDetail(r.id, r.type);
        if (info.err) {
          if (info.err === '429') {
            // 429 → 退避, 不算失败
            RPS = Math.max(0.5, RPS / 2);
            log('429 限流, 降速到 rps=' + RPS);
            await new Promise(s => setTimeout(s, 3000));
            failed++;
            continue;
          }
          // 404 / 下架 → 只续 expires_at, 保留原海报
          failed++;
          try {
            psql(`UPDATE xx_tmdb_cache SET expires_at = NOW() + INTERVAL '35 days' WHERE tmdb_id = '${r.id}'`);
          } catch {}
          continue;
        }

        refreshed++;
        if (DRY) continue;

        // 写回: 保留原有非空字段 (COALESCE), 海报路径优先用新值, 缺失则保留旧值
        const q = (v) => "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'";
        try {
          psql(`
            UPDATE xx_tmdb_cache SET
              title = COALESCE(NULLIF(${q(info.title)},''), title),
              title_zh = COALESCE(NULLIF(${q(info.titleZh)},''), title_zh),
              original_title = COALESCE(NULLIF(${q(info.originalTitle)},''), original_title),
              poster_path = COALESCE(NULLIF(${q(info.poster)},''), poster_path),
              backdrop_path = COALESCE(NULLIF(${q(info.backdrop)},''), backdrop_path),
              overview = COALESCE(NULLIF(${q(info.overview)},''), overview),
              release_date = COALESCE(NULLIF(${q(info.releaseDate)},''), release_date),
              vote_average = COALESCE(NULLIF(${q(info.voteAvg)},''), vote_average),
              vote_count = COALESCE(NULLIF(${q(info.voteCnt)},''), vote_count),
              status = COALESCE(NULLIF(${q(info.status)},''), status),
              tagline = COALESCE(NULLIF(${q(info.tagline)},''), tagline),
              genres = COALESCE(NULLIF(ARRAY(SELECT unnest(string_to_array(${q(info.genres)}, ','))), NULL), genres),
              origin_country = COALESCE(NULLIF(${q(info.countries)},''), origin_country),
              cached_at = NOW(),
              expires_at = NOW() + INTERVAL '35 days'
            WHERE tmdb_id = '${r.id}'
          `);
        } catch (e) {
          failed++;
          log('写库失败', r.id, (e?.message || '').slice(0, 120));
        }
      }
    });

    await Promise.all(workers);

    const st = {
      processed, refreshed, failed, notFound,
      updatedAt: new Date().toISOString(),
      startedAt: state.startedAt || new Date().toISOString(),
    };
    saveState(st);
    log(`=== 批次结束: 已处理 ${processed} 刷新 ${refreshed} 失败 ${failed} | rps=${RPS.toFixed(1)} ===`);
  }

  saveState({ processed, refreshed, failed, notFound, updatedAt: new Date().toISOString() });
  log(`=== 全部结束: 处理 ${processed} 刷新 ${refreshed} 失败 ${failed} ===`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
