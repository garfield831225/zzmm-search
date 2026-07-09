// 单独 API: /api/tmdb-credits/[type]/[id]
// 按需拉演员表 + backdrop, 写 xx_tmdb_cache
// 首次拉取 ~500ms, 后续读 cache 0ms
import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const TMDB_KEYS = [
  '7985342d5961e9ee3d5ef6d969c1b8dd',
  '79e41efe870e60afb09b9de8baa47cf1',
];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

class RateLimiter {
  private lastCalls = TMDB_KEYS.map(() => 0);
  private readonly minInterval = 50;
  async wait(keyIndex: number) {
    const now = Date.now();
    const waitTime = Math.max(0, this.lastCalls[keyIndex] + this.minInterval - now);
    if (waitTime > 0) await new Promise(r => setTimeout(r, waitTime));
    this.lastCalls[keyIndex] = Date.now();
  }
}
const limiter = new RateLimiter();

async function fetchTmdb(path: string, params: Record<string, string>, keyIdx = 0) {
  await limiter.wait(keyIdx);
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', TMDB_KEYS[keyIdx]);
  url.searchParams.set('language', 'zh-CN');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  try {
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// 拉 credits (前 10 主演 + 头像)
async function getCredits(type: 'movie' | 'tv', tmdbId: string) {
  const data = await fetchTmdb(`/${type}/${tmdbId}/credits`, {});
  if (!data?.cast) return null;

  // 限制前 10 个 + 按 popularity 排序
  const cast = (data.cast || [])
    .sort((a: any, b: any) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 10)
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      profile_path: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : null,
      order: c.order,
    }));

  const crew = (data.crew || [])
    .filter((c: any) => ['Director', 'Producer', 'Writer', 'Screenplay'].includes(c.job))
    .slice(0, 5)
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      job: c.job,
      profile_path: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : null,
    }));

  return { cast, crew, cached_at: new Date().toISOString() };
}

// 拉 detail (拿 backdrop_path + 缺失字段)
async function getDetail(type: 'movie' | 'tv', tmdbId: string) {
  return await fetchTmdb(`/${type}/${tmdbId}`, {});
}

export async function GET(req: Request, { params }: { params: { type: string; id: string } }) {
  const type = params.type as 'movie' | 'tv';
  const tmdbId = params.id;
  const force = new URL(req.url).searchParams.get('force') === '1';

  if (type !== 'movie' && type !== 'tv') {
    return NextResponse.json({ error: 'type must be movie|tv' }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 1. 查 cache
    const cached = await sql`SELECT credits, backdrop_path, overview, tagline, genres, title, original_title, vote_average, vote_count, credits_cached_at FROM xx_tmdb_cache WHERE tmdb_id = ${tmdbId} AND tmdb_type = ${type}`;

    if (cached[0]?.credits && cached[0]?.backdrop_path && !force) {
      // 全有 → 直接返
      return NextResponse.json({
        source: 'cache',
        cast: cached[0].credits.cast || [],
        crew: cached[0].credits.crew || [],
        backdrop_path: cached[0].backdrop_path,
        overview: cached[0].overview,
        tagline: cached[0].tagline,
        genres: cached[0].genres,
        title: cached[0].title,
        original_title: cached[0].original_title,
        vote_average: cached[0].vote_average,
        vote_count: cached[0].vote_count,
      });
    }

    // 2. 缺 → 拉 TMDB
    console.log(`[tmdb-credits] cache miss, fetching ${type}/${tmdbId}`);
    const [credits, detail] = await Promise.all([
      getCredits(type, tmdbId),
      getDetail(type, tmdbId),
    ]);

    if (!credits && !detail) {
      return NextResponse.json({ error: 'TMDB fetch failed' }, { status: 502 });
    }

    const backdrop = detail?.backdrop_path ? `${TMDB_IMG}/w1280${detail.backdrop_path}` : null;
    const overview = detail?.overview || cached[0]?.overview || null;
    const tagline = detail?.tagline || cached[0]?.tagline || null;
    const genres = detail?.genres?.map((g: any) => g.name) || cached[0]?.genres || [];

    // 3. 写 cache (ON CONFLICT DO UPDATE)
    await sql`
      INSERT INTO xx_tmdb_cache (
        tmdb_id, tmdb_type, title, original_title, overview,
        poster_path, backdrop_path, vote_average, vote_count, release_date,
        status, tagline, genres, credits, credits_cached_at, cached_at
      )
      VALUES (
        ${tmdbId}, ${type}, ${detail?.title || detail?.name || cached[0]?.title || ''},
        ${detail?.original_title || detail?.original_name || cached[0]?.original_title || null},
        ${overview}, ${detail?.poster_path ? `${TMDB_IMG}/w500${detail.poster_path}` : null},
        ${backdrop}, ${String(detail?.vote_average || cached[0]?.vote_average || '0')},
        ${String(detail?.vote_count || cached[0]?.vote_count || '0')},
        ${detail?.release_date || detail?.first_air_date || null},
        ${detail?.status || null}, ${tagline},
        ${genres}, ${JSON.stringify(credits || { cast: [], crew: [] })}::jsonb,
        NOW(), NOW()
      )
      ON CONFLICT (tmdb_id) DO UPDATE SET
        backdrop_path = COALESCE(EXCLUDED.backdrop_path, xx_tmdb_cache.backdrop_path),
        overview = COALESCE(EXCLUDED.overview, xx_tmdb_cache.overview),
        tagline = COALESCE(EXCLUDED.tagline, xx_tmdb_cache.tagline),
        genres = COALESCE(EXCLUDED.genres, xx_tmdb_cache.genres),
        credits = EXCLUDED.credits,
        credits_cached_at = NOW(),
        cached_at = NOW()
    `;

    return NextResponse.json({
      source: 'fresh',
      cast: credits?.cast || [],
      crew: credits?.crew || [],
      backdrop_path: backdrop,
      overview,
      tagline,
      genres,
      title: detail?.title || detail?.name || cached[0]?.title,
      original_title: detail?.original_title || detail?.original_name || cached[0]?.original_title,
      vote_average: detail?.vote_average || cached[0]?.vote_average,
      vote_count: detail?.vote_count || cached[0]?.vote_count,
    });
  } catch (e: any) {
    console.error('[tmdb-credits error]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}