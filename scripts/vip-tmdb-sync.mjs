#!/usr/bin/env node
// 2026-07-24 zzmm-vip - TMDB 同步脚本 (Phase 1: 拉列表 + 入库基础信息)
// 跑法: node scripts/vip-tmdb-sync.mjs --media movie --kind popular --pages 50
// 部署: NAS cron, 走 Windows Clash 代理
//
// 双 key throttle 50ms = 100 req/sec
// 首批: popular movie/tv 各 50 页 + top_rated 各 25 页 = 3000 条
//
// 入库: ON CONFLICT (tmdb_id, media_type) DO UPDATE (upsert)

import { neon } from '@neondatabase/serverless';
import { setGlobalDispatcher, ProxyAgent } from 'undici';

const HTTP_PROXY = process.env.HTTP_PROXY || 'http://192.168.3.3:7897';
const DB_URL = process.env.DATABASE_URL;

const TMDB_KEYS = [
  process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd',
  process.env.TMDB_API_KEY_2 || '79e41efe870e60afb09b9de8baa47cf1',
].filter(Boolean);

if (!DB_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

if (TMDB_KEYS.length === 0) {
  console.error('❌ TMDB_API_KEY_1/2 not set');
  process.exit(1);
}

// 代理
const dispatcher = new ProxyAgent(HTTP_PROXY);
setGlobalDispatcher(dispatcher);

const sql = neon(DB_URL);

// ---- 简单限流: 双 key 轮询, 50ms 间隔 ----
let keyIdx = 0;
let lastReqAt = 0;
const KEY_INTERVAL_MS = 50;

async function tmdbFetch(path) {
  const url = `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${TMDB_KEYS[keyIdx]}`;
  keyIdx = (keyIdx + 1) % TMDB_KEYS.length;

  // throttle
  const now = Date.now();
  const wait = KEY_INTERVAL_MS - (now - lastReqAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReqAt = Date.now();

  const resp = await fetch(url, {
    headers: { 'Accept-Language': 'zh-CN,en-US;q=0.5' },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`TMDB ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ---- 工具 ----
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { media: 'movie', kind: 'popular', pages: 50, startPage: 1 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--media') opts.media = args[++i];
    else if (args[i] === '--kind') opts.kind = args[++i];
    else if (args[i] === '--pages') opts.pages = parseInt(args[++i], 10);
    else if (args[i] === '--start-page') opts.startPage = parseInt(args[++i], 10);
  }
  return opts;
}

function validateOpts(opts) {
  if (!['movie', 'tv'].includes(opts.media)) throw new Error('media must be movie|tv');
  if (!['popular', 'top_rated', 'now_playing', 'on_the_air'].includes(opts.kind)) {
    throw new Error('kind must be popular|top_rated|now_playing|on_the_air');
  }
  if (opts.media === 'movie' && (opts.kind === 'on_the_air')) {
    throw new Error('on_the_air only for tv');
  }
  if (opts.media === 'tv' && (opts.kind === 'now_playing')) {
    throw new Error('now_playing only for movie');
  }
}

// ---- 同步日志 ----
async function logSyncStart(opts) {
  const rows = await sql`
    INSERT INTO xx_vip_sync_log (sync_type, source, status, started_at)
    VALUES ('tmdb', ${`${opts.media}:${opts.kind}`}, 'running', NOW())
    RETURNING id`;
  return rows[0]?.id;
}

async function logSyncEnd(id, status, total, success, fail, errorMsg = null) {
  await sql`
    UPDATE xx_vip_sync_log
    SET status = ${status},
        total_count = ${total},
        success_count = ${success},
        fail_count = ${fail},
        error_msg = ${errorMsg},
        finished_at = NOW(),
        duration_ms = EXTRACT(MILLISECOND FROM (NOW() - started_at))::int
    WHERE id = ${id}`;
}

// ---- 入库 (upsert) ----
async function upsertOne(r) {
  const mediaType = r.media_type;
  const releaseDate = r.release_date || r.first_air_date || null;
  const runtime = r.runtime || (r.episode_run_time?.[0]) || null;
  const seasonCount = r.number_of_seasons || null;
  const episodeCount = r.number_of_episodes || null;
  const status = r.status || null;
  const lastEp = r.last_episode_to_air ? JSON.stringify(r.last_episode_to_air) : null;
  const nextEp = r.next_episode_to_air ? JSON.stringify(r.next_episode_to_air) : null;
  const popularity = r.popularity || 0;
  const voteAvg = r.vote_average || 0;
  const voteCnt = r.vote_count || 0;
  const title = r.title || r.name || r.original_title || r.original_name || '(no title)';
  const originalTitle = r.original_title || r.original_name || null;
  const overview = r.overview || null;
  const rawJson = JSON.stringify(r);

  await sql`
    INSERT INTO xx_vip_resources (
      tmdb_id, media_type, title, original_title, original_language,
      poster_path, backdrop_path, overview, vote_average, vote_count,
      release_date, first_air_date, genre_ids, popularity,
      season_count, episode_count, status,
      last_episode_to_air, next_episode_to_air, runtime,
      raw_json, tmdb_fetched_at, updated_at
    ) VALUES (
      ${r.id}, ${mediaType}, ${title}, ${originalTitle}, ${r.original_language || null},
      ${r.poster_path || null}, ${r.backdrop_path || null}, ${overview}, ${voteAvg}, ${voteCnt},
      ${r.release_date || null}, ${r.first_air_date || null},
      ${r.genre_ids || []}::int[], ${popularity},
      ${seasonCount}, ${episodeCount}, ${status},
      ${lastEp}::jsonb, ${nextEp}::jsonb, ${runtime},
      ${rawJson}::jsonb, NOW(), NOW()
    )
    ON CONFLICT (tmdb_id, media_type) DO UPDATE SET
      title = EXCLUDED.title,
      original_title = EXCLUDED.original_title,
      poster_path = EXCLUDED.poster_path,
      backdrop_path = EXCLUDED.backdrop_path,
      overview = EXCLUDED.overview,
      vote_average = EXCLUDED.vote_average,
      vote_count = EXCLUDED.vote_count,
      release_date = EXCLUDED.release_date,
      first_air_date = EXCLUDED.first_air_date,
      genre_ids = EXCLUDED.genre_ids,
      popularity = EXCLUDED.popularity,
      season_count = EXCLUDED.season_count,
      episode_count = EXCLUDED.episode_count,
      status = EXCLUDED.status,
      last_episode_to_air = EXCLUDED.last_episode_to_air,
      next_episode_to_air = EXCLUDED.next_episode_to_air,
      runtime = EXCLUDED.runtime,
      raw_json = EXCLUDED.raw_json,
      tmdb_fetched_at = NOW(),
      updated_at = NOW()
  `;
}

// ---- 主循环 ----
async function main() {
  const opts = parseArgs();
  validateOpts(opts);
  console.log('▶ TMDB 同步启动');
  console.log('  media:', opts.media);
  console.log('  kind:', opts.kind);
  console.log('  pages:', opts.pages, '(从 page', opts.startPage, '开始)');
  console.log('  proxy:', HTTP_PROXY);
  console.log('  keys:', TMDB_KEYS.length, '个');

  const logId = await logSyncStart(opts);
  let total = 0, success = 0, fail = 0;
  const fails = [];

  for (let page = opts.startPage; page < opts.startPage + opts.pages; page++) {
    try {
      const data = await tmdbFetch(`/${opts.media}/${opts.kind}?language=zh-CN&page=${page}`);
      const results = data.results || [];
      total += results.length;
      console.log(`  page ${page}: 拿到 ${results.length} 条`);

      for (const r of results) {
        try {
          // 列表没 runtime/episode_count, 标 null, 等 Phase 2 拉详情再补
          r.media_type = opts.media;
          await upsertOne(r);
          success++;
        } catch (e) {
          fail++;
          if (fails.length < 10) fails.push({ id: r.id, err: e.message });
        }
      }
    } catch (e) {
      fail++;
      console.error(`  page ${page} 失败:`, e.message);
      fails.push({ page, err: e.message });
      // rate limit 触顶: 多睡一下
      if (e.message.includes('429') || e.message.includes('rate limit')) {
        console.log('  ⏸ sleep 5s 避免被封');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  await logSyncEnd(logId, fail > 0 ? (success > 0 ? 'partial' : 'failed') : 'success', total, success, fail,
    fail > 0 ? `前 10 个失败: ${JSON.stringify(fails)}` : null);

  console.log(`\n✅ 完成: 总 ${total}, 成功 ${success}, 失败 ${fail}`);
  process.exit(fail > 0 && success === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ 异常:', e);
  process.exit(1);
});
