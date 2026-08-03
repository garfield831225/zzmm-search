// 2026-08-03: P5.3 admin TMDB 搜索 API
//   - GET /api/admin/tmdb-search?q=...&type=multi|movie|tv
//   - 走 themoviedb.org /3/search/{type}
//   - 中文优先 + 英文 fallback

import { NextRequest, NextResponse } from 'next/server';
import { authAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';

export async function GET(request: NextRequest) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  const type = (sp.get('type') || 'multi').toLowerCase();

  if (!q) return NextResponse.json({ error: '缺少 q 参数' }, { status: 400 });
  if (!['multi', 'movie', 'tv'].includes(type)) {
    return NextResponse.json({ error: 'type 必须是 multi/movie/tv' }, { status: 400 });
  }

  if (!TMDB_API_KEY) {
    return NextResponse.json({ error: 'TMDB_API_KEY 未配置' }, { status: 500 });
  }

  try {
    // 2026-08-03: zh-CN 优先, 拿不到再 en-US
    const langs = ['zh-CN', 'en-US'];
    let primaryResults: any[] = [];

    for (const lang of langs) {
      const url = `${TMDB_BASE}/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q)}&language=${lang}&page=1&include_adult=false`;
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const d = await r.json();
      primaryResults = d.results || [];
      if (primaryResults.length > 0) break;
    }

    const results = primaryResults.slice(0, 20).map((r: any) => ({
      tmdbId: r.id,
      tmdbType: r.media_type || (r.title ? 'movie' : 'tv'),
      title: r.title || r.name || r.original_title || r.original_name,
      originalTitle: r.original_title || r.original_name,
      posterPath: r.poster_path,
      backdropPath: r.backdrop_path,
      releaseDate: r.release_date || r.first_air_date,
      voteAverage: r.vote_average,
      overview: r.overview,
    }));

    return NextResponse.json({ success: true, query: q, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
