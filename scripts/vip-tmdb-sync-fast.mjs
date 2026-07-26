// vip-tmdb-sync-fast.mjs: 走 Windows 系统代理 127.0.0.1:7897 (clash)
// 不走 NAS 代理 (192.168.3.3 慢), 不直连 (被墙)
import { ProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';
import { neon } from '@neondatabase/serverless';

const PROXY = process.env.HTTP_PROXY || 'http://127.0.0.1:7897';
setGlobalDispatcher(new ProxyAgent(PROXY));

const DB_URL = process.env.DATABASE_URL;
const TMDB_KEYS = [
  process.env.TMDB_API_KEY_1 || process.env.TMDB_API_KEY || '7985342d5961e9ee3d5ef6d969c1b8dd',
  process.env.TMDB_API_KEY_2 || '79e41efe870e60afb09b9de8baa47cf1',
].filter(Boolean);

if (!DB_URL) { console.error('❌ DATABASE_URL'); process.exit(1); }

const sql = neon(DB_URL);
let keyIdx = 0;
let lastReqAt = 0;
const KEY_INTERVAL_MS = 80;

async function tmdbFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_KEYS[keyIdx]}`;
  keyIdx = (keyIdx + 1) % TMDB_KEYS.length;
  const now = Date.now();
  const wait = KEY_INTERVAL_MS - (now - lastReqAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReqAt = Date.now();
  const r = await undiciFetch(url, { headers: { 'Accept-Language': 'zh-CN,en-US;q=0.5' } });
  if (!r.ok) throw new Error(`TMDB ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { media: 'movie', kind: 'popular', pages: 30 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--media') opts.media = args[++i];
    else if (args[i] === '--kind') opts.kind = args[++i];
    else if (args[i] === '--pages') opts.pages = parseInt(args[++i], 10);
  }
  return opts;
}

async function upsertOne(r) {
  const mediaType = r.media_type;
  const title = r.title || r.name || r.original_title || r.original_name || '(no title)';
  const originalTitle = r.original_title || r.original_name || null;
  const runtime = r.runtime || (r.episode_run_time && r.episode_run_time[0]) || null;
  const seasonCount = r.number_of_seasons || null;
  const episodeCount = r.number_of_episodes || null;
  const status = r.status || null;
  const lastEp = r.last_episode_to_air ? JSON.stringify(r.last_episode_to_air) : null;
  const nextEp = r.next_episode_to_air ? JSON.stringify(r.next_episode_to_air) : null;
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
      ${r.poster_path || null}, ${r.backdrop_path || null}, ${r.overview || null}, ${r.vote_average || 0}, ${r.vote_count || 0},
      ${r.release_date || null}, ${r.first_air_date || null},
      ${r.genre_ids || []}::int[], ${r.popularity || 0},
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

async function logStart(opts) {
  const r = await sql`INSERT INTO xx_vip_sync_log (sync_type, source, status, started_at) VALUES ('tmdb', ${`${opts.media}:${opts.kind}`}, 'running', NOW()) RETURNING id`;
  return r[0]?.id;
}
async function logEnd(id, status, total, success, fail, err = null) {
  await sql`UPDATE xx_vip_sync_log SET status=${status}, total_count=${total}, success_count=${success}, fail_count=${fail}, error_msg=${err}, finished_at=NOW() WHERE id=${id}`;
}

async function main() {
  const opts = parseArgs();
  console.log(`▶ [FAST] TMDB ${opts.media}/${opts.kind} ${opts.pages} pages`);
  const logId = await logStart(opts);
  let total = 0, success = 0, fail = 0;
  for (let page = 1; page <= opts.pages; page++) {
    try {
      const data = await tmdbFetch(`/${opts.media}/${opts.kind}?language=zh-CN&page=${page}`);
      const results = data.results || [];
      total += results.length;
      for (const r of results) {
        try { r.media_type = opts.media; await upsertOne(r); success++; }
        catch (e) { fail++; if (fail < 5) console.error('upsert err:', e.message); }
      }
      if (page % 5 === 0) console.log(`  page ${page}/${opts.pages}: ok=${success} fail=${fail}`);
    } catch (e) {
      fail++;
      console.error(`  page ${page} ERR:`, e.message);
      if (e.message.includes('429')) await new Promise(r => setTimeout(r, 5000));
    }
  }
  await logEnd(logId, fail > 0 && success === 0 ? 'failed' : (fail > 0 ? 'partial' : 'success'), total, success, fail);
  console.log(`✅ DONE: total=${total} success=${success} fail=${fail}`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
