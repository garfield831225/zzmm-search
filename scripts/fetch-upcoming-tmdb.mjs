// 每天拉过去 30 天上映的 movie + tv - xx_upcoming 表
// 用法: node scripts/fetch-upcoming-tmdb.mjs [--days 30] [--limit 500]
import { appendFileSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { neon } from '@neondatabase/serverless';

// .env 解析
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

const PROXY_URL = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || 'http://192.168.3.3:7897';
if (PROXY_URL) {
  try { setGlobalDispatcher(new ProxyAgent({ uri: PROXY_URL })); } catch (e) {}
}

// 轮询 2 个 API key
const TMDB_KEYS = [process.env.TMDB_API_KEY_1, process.env.TMDB_API_KEY_2].filter(Boolean);
let keyIdx = 0;
function getKey() { return TMDB_KEYS[keyIdx % TMDB_KEYS.length]; }
function rotateKey() { keyIdx++; }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return def;
};
const DAYS = parseInt(getArg('--days', '30'));
const PAGES = parseInt(getArg('--pages', '3'));  // 3 pages × 20 = 60 per type (movie + tv)

const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

const today = new Date();
const past = new Date();
past.setDate(past.getDate() - DAYS);
const fmt = (d) => d.toISOString().split('T')[0];
const todayStr = fmt(today);
const pastStr = fmt(past);

console.log(`[1] 拉取 ${pastStr} ~ ${todayStr} (过去 ${DAYS} 天) 的 movie + tv, 每类 ${PAGES} 页`);

async function tmdbFetch(path) {
  const url = `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${getKey()}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'zzmm-search/1.0' } });
  if (!r.ok) {
    if (r.status === 429) {
      console.log(`  rate limit, rotate key`);
      rotateKey();
      return tmdbFetch(path);
    }
    throw new Error(`TMDB ${r.status}: ${path}`);
  }
  return r.json();
}

async function fetchOne(type) {
  // type: 'movie' or 'tv'
  const releaseGte = `primary_release_date.gte=${pastStr}`;
  const releaseLte = `primary_release_date.lte=${todayStr}`;
  const firstGte = `first_air_date.gte=${pastStr}`;
  const firstLte = `first_air_date.lte=${todayStr}`;
  const sort = `sort_by=popularity.desc`;
  const lang = `language=zh-CN`;

  const allResults = [];
  for (let p = 1; p <= PAGES; p++) {
    const dateGte = type === 'movie' ? releaseGte : firstGte;
    const dateLte = type === 'movie' ? releaseLte : firstLte;
    const path = `/${type === 'movie' ? 'discover/movie' : 'discover/tv'}?${dateGte}&${dateLte}&${sort}&${lang}&page=${p}`;
    const d = await tmdbFetch(path);
    allResults.push(...(d.results || []));
    await sleep(250);
  }
  return allResults;
}

async function upsertBatch(type, items) {
  let inserted = 0, updated = 0;
  for (const it of items) {
    if (!it.id || !(it.release_date || it.first_air_date)) continue;
    const releaseDate = it.release_date || it.first_air_date;
    const title = it.title || it.name || '';
    const originalTitle = it.original_title || it.original_name || '';
    const r = await sql`
      INSERT INTO xx_upcoming (tmdb_id, tmdb_type, title, original_title, release_date, poster_path, backdrop_path, vote_average, overview, fetched_at)
      VALUES (${it.id}, ${type}, ${title}, ${originalTitle}, ${releaseDate}, ${it.poster_path || null}, ${it.backdrop_path || null}, ${it.vote_average || null}, ${it.overview || null}, NOW())
      ON CONFLICT (tmdb_id, tmdb_type) DO UPDATE SET
        title = EXCLUDED.title,
        original_title = EXCLUDED.original_title,
        release_date = EXCLUDED.release_date,
        poster_path = EXCLUDED.poster_path,
        backdrop_path = EXCLUDED.backdrop_path,
        vote_average = EXCLUDED.vote_average,
        overview = EXCLUDED.overview,
        status = 'active',
        fetched_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }
  return { inserted, updated };
}

(async () => {
  // 1. 拉 movie
  console.log(`\n[2] TMDB discover movie (${pastStr} ~ ${todayStr})...`);
  let movies = [];
  try {
    movies = await fetchOne('movie');
    console.log(`  拉到 ${movies.length} 部 movie`);
  } catch (e) {
    console.log(`  ✗ movie 拉取失败: ${e.message}`);
  }

  // 2. 拉 tv
  console.log(`\n[3] TMDB discover tv (${pastStr} ~ ${todayStr})...`);
  let tvs = [];
  try {
    tvs = await fetchOne('tv');
    console.log(`  拉到 ${tvs.length} 部 tv`);
  } catch (e) {
    console.log(`  ✗ tv 拉取失败: ${e.message}`);
  }

  // 3. UPSERT
  console.log(`\n[4] UPSERT 到 xx_upcoming...`);
  const mRes = await upsertBatch('movie', movies);
  console.log(`  movie: ${mRes.inserted} inserted / ${mRes.updated} updated`);
  const tRes = await upsertBatch('tv', tvs);
  console.log(`  tv: ${tRes.inserted} inserted / ${tRes.updated} updated`);

  // 4. 清理过期
  console.log(`\n[5] 清理过期 (release_date < ${pastStr})...`);
  const del = await sql`UPDATE xx_upcoming SET status = 'inactive' WHERE release_date < ${pastStr}::date AND status = 'active' RETURNING id`;
  console.log(`  inactive ${del.length} 条`);

  // 5. 报告
  const stats = await sql`SELECT tmdb_type, count(*) as cnt FROM xx_upcoming WHERE status = 'active' GROUP BY tmdb_type`;
  console.log(`\n[6] xx_upcoming active 总数:`);
  for (const r of stats) console.log(`  ${r.tmdb_type}: ${r.cnt}`);

  console.log(`\n=== FINAL: movie+tv fetched=${movies.length + tvs.length}, active cleared ===`);
})();
