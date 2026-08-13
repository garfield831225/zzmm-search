// 2026-08-04: P9.5 /api/vip 列表直接查 v_xx_vip_resources_with_link view
//   - 血教训 #25: 我之前用 xx_resources JOIN xx_vip_links 配对, 只筛出 77 个 (xx_resources 跟 xx_vip_resources 的 tmdb_id 配对覆盖率极低)
//   - 用户原话"我是看视频的专区你给我弄成什么了" - 实际 VIP 视频源是 xingfan daily 同步进 xx_vip_resources + xx_vip_links 的, 跟 xx_resources 是两条线
//   - 真视频源表: v_xx_vip_resources_with_link view (xx_vip_resources LEFT JOIN xx_vip_links status='ok' LIMIT 1)
//   - view 总 19981 条, 1578 条有 play_url (560 movie + 1018 tv)
//   - /vip 列表直接用 view, 不走 xx_resources (xx_resources 是基于 access_level='vip' 标签, 跟 playerla 视频源是两条线)
//
// resourceId 语义: v_xx_vip_resources_with_link.id = xx_vip_resources.id (bigint, 1-N)

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_IMAGE_BASE = 'https://image.zzmm-search.uk/t/p/w500';  // 2026-08-14: 切到国内 CF Worker 反代 (国内快, 跨太平洋慢/丢包)

export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '', {
    fetchOptions: { cache: 'no-store' },
  });

  const sp = req.nextUrl.searchParams;
  const type = (sp.get('type') || 'all').toLowerCase();
  const page = parseInt(sp.get('page') || '1');
  const pageSize = Math.min(parseInt(sp.get('pageSize') || '60'), 100);

  try {
    const isMovie = type === 'movie';
    const isTv = type === 'tv';
    const isAll = type === 'all';

    // 2026-08-04 P9.5 改: 直接查 v_xx_vip_resources_with_link view
    //   - 这是 xingfan daily 同步过来的真视频源 (playerla iframe URL)
    //   - view.id = xx_vip_resources.id, 直接给前端当 resourceId
    //   - 不用 xx_resources JOIN (两条数据线, 配对率极低)
    const rows = await sql`
      SELECT
        v.id AS resource_id,
        v.tmdb_id,
        v.media_type,
        v.title,
        v.original_title,
        v.poster_path,
        v.backdrop_path,
        v.overview,
        v.vote_average,
        v.vote_count,
        v.release_date,
        v.genre_ids,
        v.status,
        v.season_count,
        v.episode_count,
        v.runtime,
        v.play_url,
        v.link_source,
        v.link_id
      FROM v_xx_vip_resources_with_link v
      WHERE v.play_url IS NOT NULL
        AND (${isAll} OR v.media_type = ${type})
      ORDER BY v.release_date DESC NULLS LAST, v.id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    const totalRow = await sql`
      SELECT COUNT(*) AS cnt
      FROM v_xx_vip_resources_with_link v
      WHERE v.play_url IS NOT NULL
        AND (${isAll} OR v.media_type = ${type})
    `;
    const total = parseInt(totalRow[0]?.cnt || '0');

    // 2026-08-04 P9.5 改: 字段映射 v_xx_vip_resources_with_link view 字段
    //   - v.id (vip_resource.id, bigint) → resourceId
    //   - v.tmdb_id (integer) → tmdbId (string 化, 跟旧 /api/vip 字段对齐)
    //   - v.media_type ('movie'|'tv') → tmdbType
    //   - v.title / v.original_title 直接用 (view 已经 JOIN 过来了)
    //   - resourceCount = link 总数 (用 subquery 算)
    const items = rows.map((r: any) => ({
      resourceId: Number(r.resource_id),
      tmdbId: r.tmdb_id ? String(r.tmdb_id) : null,
      tmdbType: r.media_type,
      title: r.title || '',
      originalTitle: r.original_title,
      posterPath: r.poster_path,
      posterUrl: r.poster_path
        ? (r.poster_path.startsWith('http') ? r.poster_path : `${TMDB_IMAGE_BASE}${r.poster_path}`)
        : null,
      backdropUrl: r.backdrop_path
        ? (r.backdrop_path.startsWith('http') ? r.backdrop_path : `https://image.tmdb.org/t/p/w1280${r.backdrop_path}`)
        : null,
      overview: r.overview,
      releaseDate: r.release_date,
      voteAverage: r.vote_average ? parseFloat(r.vote_average) : null,
      voteCount: r.vote_count ? parseInt(r.vote_count) : 0,
      genreIds: r.genre_ids || [],
      source: r.link_source || 'xingfan',
      accessLevel: 'vip',
      category: r.media_type === 'tv' ? '剧集' : '电影',
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
