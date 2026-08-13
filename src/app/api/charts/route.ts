// 2026-08-14: 公共 API - 观影推荐榜单 (TMDB discover with watch_providers)
//   GET /api/charts?provider=netflix&region=US&type=movie&page=1
//   - 5 平台 (netflix/prime/disney/appletv/crunchyroll) × 10 国家 × 2 type (movie/tv) = 100 cache keys
//   - 缓存 6h (用户原话 6h)
//   - 关联 xx_resources: 返 resourceCount + sources (本地有多少个网盘)
// 2026-08-14: 公共 API, CORS * (moviezone/子站能调)
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const PROVIDER_MAP: Record<string, number> = {
  netflix: 8,
  prime: 119,         // Prime Video
  disney: 337,        // Disney+
  appletv: 350,       // Apple TV+
  crunchyroll: 283,
};
const PROVIDER_NAME: Record<string, string> = {
  netflix: 'Netflix',
  prime: 'Prime Video',
  disney: 'Disney+',
  appletv: 'Apple TV+',
  crunchyroll: 'Crunchyroll',
};
const VALID_REGIONS = new Set(['US', 'ES', 'GB', 'MX', 'AR', 'CO', 'DE', 'FR', 'BR', 'IT']);
const VALID_TYPES = new Set(['movie', 'tv']);

const TMDB_KEYS = [
  process.env.TMDB_API_KEY_1,
  process.env.TMDB_API_KEY_2,
].filter(Boolean) as string[];

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6 小时

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const { searchParams } = new URL(req.url);
  const provider = (searchParams.get('provider') || '').toLowerCase();
  const region = (searchParams.get('region') || 'US').toUpperCase();
  const type = (searchParams.get('type') || 'movie').toLowerCase();
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));

  if (!PROVIDER_MAP[provider]) {
    return NextResponse.json(
      { error: { code: 'invalid_provider', message: 'provider 必须是 netflix/prime/disney/appletv/crunchyroll', hint: `实际: ${provider}` } },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!VALID_REGIONS.has(region)) {
    return NextResponse.json(
      { error: { code: 'invalid_region', message: 'region 必须是 US/ES/GB/MX/AR/CO/DE/FR/BR/IT', hint: `实际: ${region}` } },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json(
      { error: { code: 'invalid_type', message: 'type 必须是 movie 或 tv', hint: `实际: ${type}` } },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (TMDB_KEYS.length === 0) {
    return NextResponse.json(
      { error: { code: 'tmdb_keys_missing', message: 'TMDB_API_KEY_1/2 未配置' } },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  const providerId = PROVIDER_MAP[provider];
  const cacheKey = `charts:${providerId}:${region}:${type}:${page}`;

  // 1. 查 cache
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const cacheRows = await sql`
      SELECT data, expires_at, cached_at FROM xx_charts_cache
      WHERE cache_key = ${cacheKey} AND expires_at > NOW()
      LIMIT 1
    ` as any[];
    if (cacheRows && cacheRows[0]) {
      return NextResponse.json({
        ...cacheRows[0].data,
        cached: true,
        cachedAt: cacheRows[0].cached_at,
        expiresAt: cacheRows[0].expires_at,
        provider: PROVIDER_NAME[provider] || provider,
        region,
        type,
        page,
        durationMs: Date.now() - t0,
      }, { headers: CORS_HEADERS });
    }
  } catch (e: any) {
    // 缓存表不存在时不报错, 直接调 TMDB
    console.warn('[charts] cache read failed:', e.message);
  }

  // 2. miss -> 调 TMDB discover
  const endpoint = type === 'tv' ? '/discover/tv' : '/discover/movie';
  const watchRegionParam = `&watch_region=${region}`;
  const withWatchProvidersParam = `&with_watch_providers=${providerId}`;
  const sortBy = '&sort_by=popularity.desc';
  const pageParam = `&page=${page}`;
  const lang = `&language=zh-CN`;

  let tmdbData: any = null;
  for (let i = 0; i < TMDB_KEYS.length; i++) {
    const url = `https://api.themoviedb.org/3${endpoint}?api_key=${TMDB_KEYS[i]}${lang}${watchRegionParam}${withWatchProvidersParam}${sortBy}${pageParam}&include_adult=false`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      tmdbData = await r.json();
      if (tmdbData.results) break;
    } catch (e: any) {
      console.warn(`[charts] TMDB key ${i} failed:`, e.message);
      continue;
    }
  }
  if (!tmdbData || !tmdbData.results) {
    return NextResponse.json(
      { error: { code: 'tmdb_failed', message: 'TMDB 全部 key 调用失败' } },
      { status: 502, headers: CORS_HEADERS }
    );
  }

  // 3. 关联 xx_resources: 给每个 item 查本地资源数
  const tmdbIds = tmdbData.results
    .map((r: any) => String(r.id))
    .filter(Boolean);
  let resourceMap = new Map<string, { count: number; sources: string[] }>();
  if (tmdbIds.length > 0) {
    try {
      const rRows = await sql`
        SELECT tmdb_id, COUNT(*) as cnt, array_agg(DISTINCT source) as sources
        FROM xx_resources
        WHERE status = 'active'
          AND tmdb_id = ANY(${tmdbIds})
        GROUP BY tmdb_id
      ` as any[];
      for (const r of (rRows || [])) {
        resourceMap.set(String(r.tmdb_id), { count: parseInt(r.cnt), sources: r.sources || [] });
      }
    } catch (e: any) {
      console.warn('[charts] xx_resources query failed:', e.message);
    }
  }

  // 4. 格式化 + 加本地资源数
  const TMDB_IMG = 'https://image.zzmm-search.uk/t/p/w342';
  const items = tmdbData.results.slice(0, 20).map((r: any) => {
    const local = resourceMap.get(String(r.id));
    return {
      id: r.id,
      type,
      title: r.title || r.name || r.original_title || r.original_name || '',
      originalTitle: r.original_title || r.original_name || '',
      overview: r.overview || '',
      posterPath: r.poster_path ? `${TMDB_IMG}${r.poster_path}` : null,
      backdropPath: r.backdrop_path ? `https://image.zzmm-search.uk/t/p/w780${r.backdrop_path}` : null,
      voteAverage: r.vote_average || 0,
      voteCount: r.vote_count || 0,
      releaseDate: r.release_date || r.first_air_date || '',
      genreIds: r.genre_ids || [],
      // 本地资源关联
      localResourceCount: local?.count || 0,
      localSources: local?.sources || [],
    };
  });

  const response = {
    provider: PROVIDER_NAME[provider] || provider,
    region,
    type,
    page,
    total: tmdbData.total_results || 0,
    totalPages: tmdbData.total_pages || 1,
    items,
    cached: false,
    cachedAt: null,
    expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    durationMs: Date.now() - t0,
  };

  // 5. 写 cache
  try {
    await sql`
      INSERT INTO xx_charts_cache (cache_key, provider_id, region, type, data, expires_at)
      VALUES (${cacheKey}, ${providerId}, ${region}, ${type}, ${JSON.stringify(response)}::jsonb, NOW() + INTERVAL '6 hours')
      ON CONFLICT (cache_key) DO UPDATE SET
        data = EXCLUDED.data,
        expires_at = EXCLUDED.expires_at,
        cached_at = NOW()
    `;
  } catch (e: any) {
    console.warn('[charts] cache write failed:', e.message);
  }

  return NextResponse.json(response, { headers: CORS_HEADERS });
}
