// 2026-08-03: 返回 xx_upcoming 最新上映 30 天 movie/tv
//   - LEFT JOIN xx_resources 看是否已匹配 (有 link)
//   - has_match=true 走普通详情 (跳转 xx_resources)
//   - has_match=false 走 "待上传" 详情 (admin/user 上传)

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_IMAGE_BASE = 'https://image.zzmm-search.uk/t/p/w500';
// 2026-08-05: 首页/详情页图片优化 — Section 卡片用 w342, Banner 用 w780
// 2026-08-05 step 2: 走 CF Worker 反代 (image.zzmm-search.uk) — 解决 GFW + 30 天缓存
const TMDB_IMAGE_BASE_W342 = 'https://image.zzmm-search.uk/t/p/w342';
const TMDB_IMAGE_BASE_W780 = 'https://image.zzmm-search.uk/t/p/w780';

export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '', {
    fetchOptions: { cache: 'no-store' },
  });

  const sp = req.nextUrl.searchParams;
  const type = (sp.get('type') || 'all').toLowerCase(); // 'movie' / 'tv' / 'all'
  const page = parseInt(sp.get('page') || '1');
  const pageSize = Math.min(parseInt(sp.get('pageSize') || '30'), 100);

  try {
    // type 是 'movie' / 'tv' / 'all', 安全过滤 (枚举白名单)
    const isMovie = type === 'movie';
    const isTv = type === 'tv';
    const isAll = type === 'all';

    // LEFT JOIN xx_resources 看匹配
    const rows = await sql`
      SELECT
        u.id,
        u.tmdb_id,
        u.tmdb_type,
        u.title,
        u.original_title,
        u.release_date::text as release_date,
        u.poster_path,
        u.backdrop_path,
        u.vote_average,
        u.overview,
        r.id as matched_resource_id,
        r.name as matched_name,
        r.source as matched_source,
        r.access_level as matched_access_level,
        CASE WHEN r.id IS NOT NULL AND r.status = 'active' THEN true ELSE false END as has_match
      FROM xx_upcoming u
      LEFT JOIN xx_resources r
        ON r.tmdb_id = u.tmdb_id::text
        AND r.status = 'active'
        AND (u.tmdb_type = 'movie' AND r.category IN ('电影','原盘','REMUX','系列电影') OR u.tmdb_type = 'tv' AND r.category IN ('剧集','动漫','综艺','纪录片'))
      WHERE u.status = 'active'
        AND (${isAll} OR u.tmdb_type = ${type})
      ORDER BY u.release_date DESC, u.vote_average DESC NULLS LAST
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    const totalRow = await sql`
      SELECT count(*) as cnt FROM xx_upcoming u
      WHERE u.status = 'active'
        AND (${isAll} OR u.tmdb_type = ${type})
    `;
    const total = parseInt(totalRow[0]?.cnt || '0');

    const items = rows.map((r: any) => ({
      id: r.id,
      tmdbId: r.tmdb_id,
      tmdbType: r.tmdb_type,
      title: r.title,
      originalTitle: r.original_title,
      releaseDate: r.release_date,
      posterPath: r.poster_path,
      backdropPath: r.backdrop_path,
      posterUrl: r.poster_path ? `${TMDB_IMAGE_BASE_W342}${r.poster_path}` : null,
      backdropUrl: r.backdrop_path ? `${TMDB_IMAGE_BASE_W780}${r.backdrop_path}` : null,
      voteAverage: r.vote_average ? parseFloat(r.vote_average) : null,
      overview: r.overview,
      hasMatch: r.has_match,
      matchedResourceId: r.matched_resource_id,
      matchedName: r.matched_name,
      matchedSource: r.matched_source,
      matchedAccessLevel: r.matched_access_level,
    }));

    return NextResponse.json({
      total,
      page,
      pageSize,
      type,
      items,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
