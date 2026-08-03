/**
 * refresh-cache.mjs — 2026-07-27
 *
 * TMDB cache 定时 refresh 脚本 (user + vip 双表)
 *
 * 用途: 老 cache 一旦写就永远不动, TMDB 评分/简介/集数/状态会变, 必须定期 refresh
 * 时机:
 *   每天 23:00 跑一次: 扫 cache 7 天前的, 限速 50ms/req 拿 1000 条 refresh (按 popularity 排序, 热门的优先)
 *   每周日 02:00 全量: 1 个月+ 没动的 cache 全部重新拉 (限速 + 限 batch)
 *
 * 用法:
 *   node scripts/refresh-cache.mjs --target=user --max-age=7d --limit=1000
 *   node scripts/refresh-cache.mjs --target=vip --max-age=7d --limit=1000
 *   node scripts/refresh-cache.mjs --target=both --max-age=30d --limit=5000
 *
 * 环境变量 (.env.production):
 *   HTTP_PROXY = http://192.168.3.3:7897
 *   DATABASE_URL = postgresql://...
 *   TMDB_API_KEY_1 / TMDB_API_KEY_2 = ...
 *
 * 永久规则:
 *   - 只动 cache 表 (xx_tmdb_cache + xx_vip_resources), 不动 xx_resources 主表
 *   - 用 setGlobalDispatcher(ProxyAgent) 走 192.168.3.3:7897 绕 GFW
 *   - UPDATE ... COALESCE (新值优先, 但允许保留老值)
 *   - 写回 matched_tmdb_at (user) / tmdb_fetched_at (vip)
 *   - 限速 50ms/req, 2 keys 轮询
 */

import { appendFileSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { neon } from '@neondatabase/serverless';

// ─── 简单 .env 解析 ──────────────────────────────────────────────────────────
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}
loadEnvFile(process.env.ENV_FILE || '/app/.env.production');
loadEnvFile('.env.production');

// ─── 代理设置 ────────────────────────────────────────────────────────────────
const PROXY_URL = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || 'http://192.168.3.3:7897';
if (PROXY_URL) {
  try { setGlobalDispatcher(new ProxyAgent({ uri: PROXY_URL })); } catch (e) {}
}

// ─── 参数 ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return def;
}

const TARGET = getArg('--target', 'both');  // user | vip | both
const MAX_AGE = getArg('--max-age', '7d');  // 7d / 30d
const LIMIT = parseInt(getArg('--limit', '1000'), 10);
const LOG_FILE = getArg('--log', '/app/logs/refresh-cache.log');
const DRY_RUN = args.includes('--dry-run');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

try {
  const dir = dirname(LOG_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
} catch {}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
  console.log(JSON.stringify({ ts: Date.now(), msg: String(msg) }));
}

const TMDB_KEYS = [
  process.env.TMDB_API_KEY_1 || process.env.TMDB_API_KEY || '7985342d5961e9ee3d5ef6d969c1b8dd',
  process.env.TMDB_API_KEY_2 || '79e41efe870e60afb09b9de8baa47cf1',
];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

class RateLimiter {
  constructor() { this.lastCalls = TMDB_KEYS.map(() => 0); this.minInterval = 50; }
  async wait(keyIndex) {
    const now = Date.now();
    const waitTime = Math.max(0, this.lastCalls[keyIndex] + this.minInterval - now);
    if (waitTime > 0) await sleep(waitTime);
    this.lastCalls[keyIndex] = Date.now();
  }
}
const tmdbLimiter = new RateLimiter();

let keyIdx = 0;
async function getTmdbDetails(tmdbId, type) {
  await tmdbLimiter.wait(keyIdx);
  const url = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${TMDB_KEYS[keyIdx % TMDB_KEYS.length]}&language=zh-CN`;
  keyIdx++;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const sql = neon(process.env.DATABASE_URL);

// ─── refresh xx_tmdb_cache (user 资源 cache) ──────────────────────────────────
async function refreshUserCache() {
  log(`[user] start: max_age=${MAX_AGE} limit=${LIMIT} dry_run=${DRY_RUN}`);
  // 用 if/else 分支避开 sql.raw
  let rows;
  if (MAX_AGE === '30d') {
    rows = await sql`
      SELECT c.tmdb_id, c.tmdb_type
      FROM xx_tmdb_cache c
      WHERE c.cached_at < NOW() - INTERVAL '30 days'
        AND c.tmdb_id IS NOT NULL AND c.tmdb_id != ''
        AND length(c.tmdb_id) <= 10
        AND trim(c.tmdb_id) ~ '^[0-9]+$'
      ORDER BY COALESCE(NULLIF(c.vote_count, '')::int, 0) DESC, c.cached_at ASC
      LIMIT ${LIMIT}
    `;
  } else {
    rows = await sql`
      SELECT c.tmdb_id, c.tmdb_type
      FROM xx_tmdb_cache c
      WHERE c.cached_at < NOW() - INTERVAL '7 days'
        AND c.tmdb_id IS NOT NULL AND c.tmdb_id != ''
        AND length(c.tmdb_id) <= 10
        AND trim(c.tmdb_id) ~ '^[0-9]+$'
      ORDER BY COALESCE(NULLIF(c.vote_count, '')::int, 0) DESC, c.cached_at ASC
      LIMIT ${LIMIT}
    `;
  }
  log(`[user] target: ${rows.length} cache rows`);

  let ok = 0, fail = 0, skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const type = r.tmdb_type === 'movie' ? 'movie' : 'tv';
    const det = await getTmdbDetails(r.tmdb_id, type);
    if (!det) { fail++; continue; }

    const originalTitle = det.original_title || det.original_name || null;
    const overview = det.overview || null;
    const tagline = det.tagline || null;
    const genres = (det.genres || []).map(g => g.name);
    const backdrop = det.backdrop_path || null;
    const releaseDate = det.release_date || det.first_air_date || null;
    const voteCount = det.vote_count ?? 0;
    const originCountry = type === 'tv'
      ? (det.origin_country || []).join(',') || null
      : (det.production_countries?.[0]?.iso_3166_1 || null);

    if (DRY_RUN) { ok++; continue; }
    try {
      await sql`
        UPDATE xx_tmdb_cache SET
          original_title = COALESCE(${originalTitle}, original_title),
          overview = COALESCE(${overview}, overview),
          tagline = COALESCE(${tagline}, tagline),
          genres = COALESCE(${genres.length ? genres : null}, genres),
          backdrop_path = COALESCE(${backdrop}, backdrop_path),
          release_date = COALESCE(${releaseDate}, release_date),
          vote_count = COALESCE(${String(voteCount)}, vote_count),
          origin_country = COALESCE(${originCountry}, origin_country),
          cached_at = NOW()
        WHERE tmdb_id = ${r.tmdb_id}
      `;
      ok++;
    } catch (e) {
      fail++;
      if (fail <= 3) log(`[user] DB err ${r.tmdb_id}: ${e.message?.slice(0, 100)}`);
    }
    if ((i + 1) % 100 === 0 || i === rows.length - 1) {
      log(`[user] progress: ${i + 1}/${rows.length} ok=${ok} fail=${fail}`);
    }
  }
  log(`[user] DONE: ok=${ok} fail=${fail}`);
  return { ok, fail };
}

// ─── refresh xx_vip_resources (VIP 影视区) ───────────────────────────────────
async function refreshVipResources() {
  log(`[vip] start: max_age=${MAX_AGE} limit=${LIMIT} dry_run=${DRY_RUN}`);
  const days = MAX_AGE === '30d' ? 30 : 7;
  // 用 if/else 分支避开 Neon v3 不支持 sql.raw() 的限制
  let rows;
  if (days === 7) {
    rows = await sql`
      SELECT tmdb_id, media_type
      FROM xx_vip_resources
      WHERE tmdb_fetched_at < NOW() - INTERVAL '7 days'
      ORDER BY popularity DESC NULLS LAST, tmdb_fetched_at ASC
      LIMIT ${LIMIT}
    `;
  } else {
    rows = await sql`
      SELECT tmdb_id, media_type
      FROM xx_vip_resources
      WHERE tmdb_fetched_at < NOW() - INTERVAL '30 days'
      ORDER BY popularity DESC NULLS LAST, tmdb_fetched_at ASC
      LIMIT ${LIMIT}
    `;
  }
  log(`[vip] target: ${rows.length} vip resources`);

  let ok = 0, fail = 0, skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const type = r.media_type === 'movie' ? 'movie' : 'tv';
    const det = await getTmdbDetails(r.tmdb_id, type);
    if (!det) { fail++; continue; }

    const title = det.title || det.name || det.original_title || det.original_name;
    const originalTitle = det.original_title || det.original_name || null;
    const runtime = det.runtime || (det.episode_run_time && det.episode_run_time[0]) || null;
    const seasonCount = det.number_of_seasons || null;
    const episodeCount = det.number_of_episodes || null;
    const status = det.status || null;
    const lastEp = det.last_episode_to_air ? JSON.stringify(det.last_episode_to_air) : null;
    const nextEp = det.next_episode_to_air ? JSON.stringify(det.next_episode_to_air) : null;
    const rawJson = JSON.stringify(det);

    if (DRY_RUN) { ok++; continue; }
    try {
      await sql`
        UPDATE xx_vip_resources SET
          title = ${title},
          original_title = ${originalTitle},
          original_language = ${det.original_language || null},
          poster_path = ${det.poster_path || null},
          backdrop_path = ${det.backdrop_path || null},
          overview = ${det.overview || null},
          vote_average = ${det.vote_average || 0},
          vote_count = ${det.vote_count || 0},
          release_date = ${det.release_date || null},
          first_air_date = ${det.first_air_date || null},
          genre_ids = ${(det.genres || []).map(g => g.id).filter(Boolean)}::int[],
          popularity = ${det.popularity || 0},
          season_count = ${seasonCount},
          episode_count = ${episodeCount},
          status = ${status},
          last_episode_to_air = ${lastEp}::jsonb,
          next_episode_to_air = ${nextEp}::jsonb,
          runtime = ${runtime},
          raw_json = ${rawJson}::jsonb,
          tmdb_fetched_at = NOW(),
          updated_at = NOW()
        WHERE tmdb_id = ${r.tmdb_id} AND media_type = ${type}
      `;
      ok++;
    } catch (e) {
      fail++;
      if (fail <= 3) log(`[vip] DB err ${r.tmdb_id}: ${e.message?.slice(0, 100)}`);
    }
    if ((i + 1) % 100 === 0 || i === rows.length - 1) {
      log(`[vip] progress: ${i + 1}/${rows.length} ok=${ok} fail=${fail}`);
    }
  }
  log(`[vip] DONE: ok=${ok} fail=${fail}`);
  return { ok, fail };
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  log(`=== refresh-cache start: target=${TARGET} max_age=${MAX_AGE} limit=${LIMIT} ===`);
  const t0 = Date.now();
  let total = { ok: 0, fail: 0 };
  if (TARGET === 'user' || TARGET === 'both') {
    total = await refreshUserCache();
  }
  if (TARGET === 'vip' || TARGET === 'both') {
    const r = await refreshVipResources();
    total.ok += r.ok;
    total.fail += r.fail;
  }
  const sec = Math.round((Date.now() - t0) / 1000);
  log(`=== refresh-cache DONE: total ok=${total.ok} fail=${total.fail} in ${sec}s ===`);
  process.exit(0);
}

main().catch(e => {
  log(`FATAL: ${e.message?.slice(0, 200)}`);
  process.exit(1);
});
