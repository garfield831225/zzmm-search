#!/usr/bin/env node
/**
 * TMDB 拉新脚本（GitHub Actions + Windows 兼容）
 *
 * 设计要点：
 *   - 列表数据直接入库（不调详情，节省 50% 时间）
 *   - genres 用静态映射（不存 ID，直接映射中文名）
 *   - curl 调用（Windows 兼容；Vercel/GitHub Actions 上可换 fetch）
 *   - 速率 40 req/s + 失败重试
 *   - 状态机持久化（断点续跑）
 *   - 飞书告警（可选）
 *
 * 必填环境：TMDB_API_KEY, DATABASE_URL
 * 可选：TMDB_PROXY（curl 代理，如 http://127.0.0.1:7897）, FEISHU_WEBHOOK
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { neon } from '@neondatabase/serverless';

const execFileP = promisify(execFile);
const TMDB_KEY = process.env.TMDB_API_KEY;
const DB = process.env.DATABASE_URL
  || 'postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const RATE = 40;
const PROXY = process.env.TMDB_PROXY || '';

if (!TMDB_KEY) { console.error('❌ TMDB_API_KEY 未设置'); process.exit(1); }
const sql = neon(DB);

// ─── 静态 genres 映射（TMDB 标准）───────────────────────────────────────
const MOVIE_GENRES = { 28:'动作',12:'冒险',16:'动画',35:'喜剧',80:'犯罪',99:'纪录片',18:'剧情',10751:'家庭',14:'奇幻',36:'历史',27:'恐怖',10402:'音乐',9648:'悬疑',10749:'爱情',878:'科幻',53:'惊悚',10752:'战争',37:'西部' };
const TV_GENRES = { 10759:'动作冒险',16:'动画',35:'喜剧',80:'犯罪',99:'纪录片',18:'剧情',10751:'家庭',9648:'悬疑',10762:'儿童',10763:'新闻',10764:'真人秀',10765:'科幻奇幻',10766:'肥皂剧',10767:'脱口秀',10768:'战争政治' };
const genreName = (id, type) => (type === 'tv' ? TV_GENRES[id] : MOVIE_GENRES[id]) || `g${id}`;

// 速率控制
let lastReq = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tmdb(path, params = {}) {
  const gap = Math.ceil(1000 / RATE) - (Date.now() - lastReq);
  if (gap > 0) await sleep(gap);
  lastReq = Date.now();
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set('api_key', TMDB_KEY);
  url.searchParams.set('language', 'zh-CN');
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) url.searchParams.set(k, v);
  }
  const args = ['-s', '-m', '20', url.toString()];
  if (PROXY) args.splice(1, 0, '-x', PROXY);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { stdout } = await execFileP('curl.exe', args, { windowsHide: true, maxBuffer: 50 * 1024 * 1024 });
      const j = JSON.parse(stdout);
      if (j.status_code === 25) { await sleep(2000); continue; }  // rate limit
      if (j.status_code) throw new Error(`TMDB ${j.status_code}: ${j.status_message}`);
      return j;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1000 * attempt);
    }
  }
}

// 列表项 → 完整数据（不调详情，genres 用静态映射）
function normalizeListItem(it, type) {
  const title = it.title || it.name || '';
  const original = it.original_title || it.original_name || '';
  const genres = (it.genre_ids || []).map(id => genreName(id, type));
  // origin_country 列表里没有，detail API 才有；这里留空（详情时再补）
  return {
    id: it.id, title, original_title: original,
    overview: it.overview || null,
    poster_path: it.poster_path || null,
    backdrop_path: it.backdrop_path || null,
    release_date: it.release_date || it.first_air_date || null,
    first_air_date: it.first_air_date || it.release_date || null,
    vote_average: it.vote_average || 0,
    vote_count: it.vote_count || 0,
    popularity: it.popularity || 0,
    genres,
    origin_country: it.origin_country || [],  // 列表里通常没有
    runtime: null, status: null, tagline: it.overview ? null : null,
  };
}

async function upsertItem(it, type) {
  await sql`
    INSERT INTO xx_tmdb_discover (
      tmdb_id, tmdb_type, title, original_title, overview, poster_path,
      backdrop_path, release_date, first_air_date, vote_average, vote_count,
      popularity, genres, origin_country, runtime, status, tagline, cached_at, updated_at
    ) VALUES (
      ${it.id}, ${type}, ${it.title}, ${it.original_title},
      ${it.overview}, ${it.poster_path}, ${it.backdrop_path},
      ${it.release_date}, ${it.first_air_date},
      ${it.vote_average}, ${it.vote_count}, ${it.popularity},
      ${it.genres}, ${it.origin_country}, ${it.runtime}, ${it.status}, ${it.tagline},
      NOW(), NOW()
    )
    ON CONFLICT (tmdb_id, tmdb_type) DO UPDATE SET
      title = EXCLUDED.title, original_title = EXCLUDED.original_title,
      overview = EXCLUDED.overview, poster_path = EXCLUDED.poster_path,
      backdrop_path = EXCLUDED.backdrop_path, release_date = EXCLUDED.release_date,
      first_air_date = EXCLUDED.first_air_date,
      vote_average = EXCLUDED.vote_average, vote_count = EXCLUDED.vote_count,
      popularity = EXCLUDED.popularity,
      genres = EXCLUDED.genres, origin_country = EXCLUDED.origin_country,
      updated_at = NOW()
  `;
}

async function initState(k, t, tt, yf, yt) {
  await sql`INSERT INTO xx_tmdb_sync_state (segment_key, segment_type, tmdb_type, year_from, year_to, status)
            VALUES (${k}, ${t}, ${tt}, ${yf}, ${yt}, 'pending')
            ON CONFLICT (segment_key) DO NOTHING`;
}
async function getState(k) {
  const r = await sql`SELECT * FROM xx_tmdb_sync_state WHERE segment_key = ${k} LIMIT 1`;
  return r[0];
}
async function setState(k, u) {
  const keys = Object.keys(u), vals = Object.values(u);
  const sets = keys.map((kk, i) => `${kk} = $${i+1}`).join(', ');
  await sql(`UPDATE xx_tmdb_sync_state SET ${sets}, updated_at = NOW() WHERE segment_key = $${vals.length+1}`, [...vals, k]);
}
async function notifyFeishu(text) {
  const h = process.env.FEISHU_WEBHOOK;
  if (!h) return;
  try { await execFileP('curl.exe', ['-s','-m','5','-X','POST','-H','Content-Type: application/json','-d',JSON.stringify({msg_type:'text',content:{text}}),h]); } catch {}
}

const SEGMENTS = {
  trending_week:  { type: 'trending', tmdb_type: null },
  changes_movie:  { type: 'changes',  tmdb_type: 'movie' },
  changes_tv:     { type: 'changes',  tmdb_type: 'tv' },
  full_movie_2025:{ type: 'full', tmdb_type: 'movie', year: 2025 },
  full_movie_2024:{ type: 'full', tmdb_type: 'movie', year: 2024 },
  full_movie_2023:{ type: 'full', tmdb_type: 'movie', year: 2023 },
  full_movie_2022:{ type: 'full', tmdb_type: 'movie', year: 2022 },
  full_movie_2021:{ type: 'full', tmdb_type: 'movie', year: 2021 },
  full_tv_2025:   { type: 'full', tmdb_type: 'tv', year: 2025 },
  full_tv_2024:   { type: 'full', tmdb_type: 'tv', year: 2024 },
  full_tv_2023:   { type: 'full', tmdb_type: 'tv', year: 2023 },
};

async function runFull(seg, k) {
  const { tmdb_type, year } = seg;
  const dp = tmdb_type === 'movie' ? 'primary_release_year' : 'first_air_date_year';
  let page = 1, totalPages = 1, inserted = 0;
  const st = await getState(k);
  if (st?.last_page_processed) page = st.last_page_processed + 1;
  await setState(k, { status: 'running', started_at: new Date().toISOString() });
  console.log(`[${k}] start, page=${page}`);
  while (page <= totalPages && page <= 500) {
    const d = await tmdb(`/discover/${tmdb_type}`, { [dp]: year, sort_by: 'popularity.desc', page });
    if (page === 1) totalPages = Math.min(d.total_pages || 1, 500);
    for (const it of (d.results || [])) {
      try { await upsertItem(normalizeListItem(it, tmdb_type), tmdb_type); inserted++; }
      catch (err) { console.error(`  ! id=${it.id} ${err.message}`); }
    }
    await setState(k, { last_page_processed: page, pages_done: page, pages_total: totalPages, items_inserted: inserted });
    console.log(`  page ${page}/${totalPages} (cum ${inserted})`);
    page++;
  }
  await setState(k, { status: 'done', finished_at: new Date().toISOString(), pages_done: totalPages, pages_total: totalPages, items_inserted: inserted });
  console.log(`✅ [${k}] done, ${inserted} items`);
}

async function runChanges(seg, k) {
  const { tmdb_type } = seg;
  const today = new Date().toISOString().slice(0,10);
  const yest  = new Date(Date.now() - 86400000).toISOString().slice(0,10);
  let inserted = 0;
  await setState(k, { status: 'running', started_at: new Date().toISOString() });
  console.log(`[${k}] ${yest} → ${today}`);
  let page = 1, totalPages = 1;
  const ids = [];
  while (page <= totalPages) {
    const d = await tmdb(`/${tmdb_type}/changes`, { start_date: yest, end_date: today, page });
    if (page === 1) totalPages = d.total_pages || 1;
    for (const c of (d.results || [])) ids.push(c.id);
    page++;
  }
  console.log(`  ${ids.length} IDs`);
  for (const id of ids) {
    try {
      const d = await tmdb(`/${tmdb_type}/${id}`);
      await upsertItem({
        id: d.id, title: d.title || d.name || '',
        original_title: d.original_title || d.original_name || '',
        overview: d.overview || null,
        poster_path: d.poster_path || null, backdrop_path: d.backdrop_path || null,
        release_date: d.release_date || d.first_air_date || null,
        first_air_date: d.first_air_date || d.release_date || null,
        vote_average: d.vote_average || 0, vote_count: d.vote_count || 0, popularity: d.popularity || 0,
        genres: (d.genres || []).map(g => g.name),
        origin_country: d.production_countries?.map(c => c.iso_3166_1) || d.origin_country || [],
        runtime: d.runtime || d.episode_run_time?.[0] || null,
        status: d.status || null, tagline: d.tagline || null,
      }, tmdb_type);
      inserted++;
    } catch (err) { console.error(`  ! id=${id} ${err.message}`); }
  }
  await setState(k, { status: 'done', finished_at: new Date().toISOString(), items_inserted: inserted });
  console.log(`✅ [${k}] done, ${inserted}/${ids.length}`);
}

async function runTrending(seg, k) {
  let inserted = 0;
  await setState(k, { status: 'running', started_at: new Date().toISOString() });
  console.log(`[${k}] trending`);
  for (const type of ['movie', 'tv']) {
    const d = await tmdb(`/trending/${type}/week`);
    console.log(`  ${type}: ${d.results?.length || 0}`);
    for (const it of (d.results || [])) {
      if (!it.id) continue;
      try { await upsertItem(normalizeListItem(it, type), type); inserted++; }
      catch (err) { console.error(`  ! id=${it.id} ${err.message}`); }
    }
  }
  await setState(k, { status: 'done', finished_at: new Date().toISOString(), items_inserted: inserted });
  console.log(`✅ [${k}] done, ${inserted} items`);
}

async function main() {
  const k = process.argv.find(a => a.startsWith('--segment='))?.split('=')[1];
  if (!k) { console.error('Usage: --segment=<key>'); process.exit(1); }
  const seg = SEGMENTS[k];
  if (!seg) { console.error(`❌ unknown: ${k}`); process.exit(1); }
  await initState(k, seg.type, seg.tmdb_type, seg.year || null, seg.year || null);
  console.log(`=== 段：${k} (${seg.type}, type=${seg.tmdb_type}) ===`);
  const start = Date.now();
  try {
    if (seg.type === 'full') await runFull(seg, k);
    else if (seg.type === 'changes') await runChanges(seg, k);
    else if (seg.type === 'trending') await runTrending(seg, k);
    console.log(`🎉 完成 (${((Date.now()-start)/1000).toFixed(1)}s)`);
  } catch (e) {
    await setState(k, { status: 'failed', error_msg: e.message, finished_at: new Date().toISOString() });
    await notifyFeishu(`[TMDB 拉新失败] ${k}\n${e.message}`);
    console.error('❌ 失败:', e.message);
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
