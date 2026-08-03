// 2026-07-31: Pre-pull TMDB 内容到 xx_tmdb_cache
// 跑法: 凌晨 3 点 CST (北京时间) NAS cron 调
// 数据源: 7 天新发 (movie + tv) + 30 天热门 (movie + tv)
// 鉴权: Bearer CRON_SECRET 或 ?cronKey= query
// 不走 Vercel 60s 限制 (用 maxDuration=300 保险)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min (NAS 跑, 不受 Vercel 60s 限制)

const TMDB_BASE = 'https://api.themoviedb.org/3';
const KEY = process.env.TMDB_API_KEY || process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd';
const CACHE_TTL_DAYS = 35;

function authCron(req: NextRequest): boolean {
  // 1) Bearer
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ') && auth.slice(7) === (process.env.CRON_SECRET || 'zzmm-cron-secret-2025')) {
    return true;
  }
  // 2) ?cronKey=
  const k = req.nextUrl.searchParams.get('cronKey');
  if (k && k === (process.env.CRON_SECRET || 'zzmm-cron-secret-2025')) {
    return true;
  }
  return false;
}

// 通用 TMDB fetch
async function tmdb(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const qs = new URLSearchParams();
  qs.set('api_key', KEY);
  qs.set('language', 'zh-CN');
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const r = await fetch(`${TMDB_BASE}${path}?${qs.toString()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`TMDB ${path} ${r.status}`);
  return r.json();
}

// 算 YYYY-MM-DD N 天前
function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

interface TMDBItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  origin_country?: string[];
  genre_ids?: number[];
  media_type?: string;
}

// 把 list item 转成 cache row
function itemToCacheRow(it: TMDBItem, type: 'movie' | 'tv', window: string) {
  return {
    tmdb_id: String(it.id),
    tmdb_type: type,
    title: it.title || it.name || '',
    original_title: it.original_title || it.original_name || '',
    overview: it.overview || '',
    poster_path: it.poster_path || '',
    backdrop_path: it.backdrop_path || '',
    vote_average: it.vote_average || 0,
    vote_count: it.vote_count || 0,
    release_date: it.release_date || it.first_air_date || null,
    status: null,
    tagline: null,
    genres: [],
    origin_country: Array.isArray(it.origin_country) ? it.origin_country.join(',') : '',
    discover_window: window,
    expires_at: new Date(Date.now() + CACHE_TTL_DAYS * 86400 * 1000).toISOString(),
  };
}

// 写一批 cache (UPSERT, ON CONFLICT (tmdb_id) DO UPDATE)
async function upsertCacheBatch(sql: any, rows: any[]) {
  if (rows.length === 0) return 0;
  const BATCH = 50;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // 13 字段: tmdb_id, tmdb_type, title, original_title, overview, poster_path, backdrop_path,
    //         vote_average, vote_count, release_date, discover_window, expires_at, origin_country
    // cached_at 用 SQL NOW(), 不占参数 - 每个 row 后都加 NOW()
    const placeholders = batch.map((_, idx) => {
      const base = idx * 13;
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},NOW())`;
    }).join(',');
    const params: any[] = [];
    for (const r of batch) {
      params.push(
        r.tmdb_id, r.tmdb_type, r.title, r.original_title, r.overview,
        r.poster_path, r.backdrop_path, r.vote_average, r.vote_count,
        r.release_date, r.discover_window, r.expires_at,
        r.origin_country
      );
    }
    try {
      const r = await sql(
        `INSERT INTO xx_tmdb_cache
          (tmdb_id, tmdb_type, title, original_title, overview, poster_path, backdrop_path, vote_average, vote_count, release_date, discover_window, expires_at, origin_country, cached_at)
         VALUES ${placeholders}
         ON CONFLICT (tmdb_id) DO UPDATE SET
           tmdb_type = EXCLUDED.tmdb_type,
           title = EXCLUDED.title,
           original_title = EXCLUDED.original_title,
           overview = EXCLUDED.overview,
           poster_path = EXCLUDED.poster_path,
           backdrop_path = EXCLUDED.backdrop_path,
           vote_average = EXCLUDED.vote_average,
           vote_count = EXCLUDED.vote_count,
           release_date = EXCLUDED.release_date,
           discover_window = EXCLUDED.discover_window,
           expires_at = EXCLUDED.expires_at,
           origin_country = EXCLUDED.origin_country,
           cached_at = NOW()
         RETURNING tmdb_id`,
        params
      );
      total += (r as any[]).length;
    } catch (e: any) {
      console.error('upsertCacheBatch error:', e.message?.slice(0, 200));
    }
  }
  return total;
}

export async function GET(request: NextRequest) {
  if (!authCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const sql = neon(process.env.DATABASE_URL || '');
  const window = request.nextUrl.searchParams.get('window') || 'all';

  const stats = {
    window,
    movie_recent: 0,
    tv_recent: 0,
    movie_popular: 0,
    tv_popular: 0,
    detail_fetched: 0,
    upserted: 0,
    duration_sec: 0,
    errors: [] as string[],
  };

  try {
    const cacheRows: any[] = [];

    // 1) 7 天新发 movie
    if (window === 'all' || window === 'recent_7d') {
      try {
        for (let p = 1; p <= 5; p++) {
          const d = await tmdb('/discover/movie', {
            'primary_release_date.gte': dateStr(7),
            sort_by: 'popularity.desc',
            page: p,
          });
          for (const it of (d.results || [])) {
            cacheRows.push(itemToCacheRow(it, 'movie', 'recent_7d'));
            stats.movie_recent++;
          }
        }
      } catch (e: any) {
        stats.errors.push(`discover/movie: ${e.message?.slice(0, 100)}`);
      }

      // 2) 7 天新发 tv
      try {
        for (let p = 1; p <= 5; p++) {
          const d = await tmdb('/discover/tv', {
            'first_air_date.gte': dateStr(7),
            sort_by: 'popularity.desc',
            page: p,
          });
          for (const it of (d.results || [])) {
            cacheRows.push(itemToCacheRow(it, 'tv', 'recent_7d'));
            stats.tv_recent++;
          }
        }
      } catch (e: any) {
        stats.errors.push(`discover/tv: ${e.message?.slice(0, 100)}`);
      }
    }

    // 3) 30 天热门 movie
    if (window === 'all' || window === 'popular_30d') {
      try {
        for (let p = 1; p <= 3; p++) {
          const d = await tmdb('/movie/popular', { page: p });
          for (const it of (d.results || [])) {
            cacheRows.push(itemToCacheRow(it, 'movie', 'popular_30d'));
            stats.movie_popular++;
          }
        }
      } catch (e: any) {
        stats.errors.push(`/movie/popular: ${e.message?.slice(0, 100)}`);
      }

      // 4) 30 天热门 tv
      try {
        for (let p = 1; p <= 3; p++) {
          const d = await tmdb('/tv/popular', { page: p });
          for (const it of (d.results || [])) {
            cacheRows.push(itemToCacheRow(it, 'tv', 'popular_30d'));
            stats.tv_popular++;
          }
        }
      } catch (e: any) {
        stats.errors.push(`/tv/popular: ${e.message?.slice(0, 100)}`);
      }
    }

    // 5) 优先级高 (popular_30d) 才补 detail (拿完整 genres/countries)
    //    限制前 200 条避免超 rate limit
    const popularRows = cacheRows.filter(r => r.discover_window === 'popular_30d').slice(0, 200);
    for (const row of popularRows) {
      try {
        const path = row.tmdb_type === 'movie' ? `/movie/${row.tmdb_id}` : `/tv/${row.tmdb_id}`;
        const detail = await tmdb(path);
        row.origin_country = Array.isArray(detail.origin_country) ? detail.origin_country.join(',') : row.origin_country;
        if (detail.genres && detail.genres.length) {
          row.genres = detail.genres.map((g: any) => g.name);
        }
        if (detail.tagline) row.tagline = detail.tagline;
        if (detail.status) row.status = detail.status;
        stats.detail_fetched++;
      } catch (e: any) {
        // 不阻塞, 列表基础数据已够用
      }
    }

    // 6) 批量 UPSERT
    stats.upserted = await upsertCacheBatch(sql, cacheRows);
    stats.duration_sec = Math.round((Date.now() - startTime) / 1000);

    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message?.slice(0, 300), ...stats }, { status: 500 });
  }
}
