// 2026-08-04: P9.4 /api/vip 列表只返有 playerla 视频源的 vip 资源
//   - 2026-08-04 血教训: 12.9 万 vip 资源中只有 111 个有 xx_vip_links.ok link (覆盖率 0.086%)
//   - 用户原话"我是看视频的专区你给我弄成什么了" - 必须先保证列表里点开就有视频
//   - 用 EXISTS 过滤掉没 playerla iframe / m3u8 的资源
//   - 111 个先用着, 等同步脚本覆盖率上去了自动扩大
//
// 关联链:
//   xx_resources.tmdb_id (新表, 12.9 万 vip 资源)
//   → xx_vip_resources.tmdb_id (老表, 2 万条)
//   → xx_vip_links.resource_id (links 表, status='ok' AND play_url IS NOT NULL = 111 个)

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

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

    // 2026-08-04 P9.4 改: 加 EXISTS 子句只返有 playerla 视频源的 vip 资源
    //   - xx_vip_links.status='ok' AND play_url IS NOT NULL 的资源
    //   - JOIN xx_vip_resources 按 tmdb_id 关联
    //   - xx_vip_resources.tmdb_id 是 integer, r.tmdb_id 是 text, 必须 ::int cast
    const rows = await sql`
      WITH ranked AS (
        SELECT
          r.id as resource_id,
          r.tmdb_id,
          r.source,
          r.category,
          r.access_level,
          t.title as tmdb_title,
          t.title_zh,
          t.original_title,
          t.release_date as release_date,
          t.tmdb_type,
          t.poster_path,
          t.vote_average,
          t.overview,
          ROW_NUMBER() OVER (PARTITION BY r.tmdb_id ORDER BY r.id ASC) as rn,
          count(*) OVER (PARTITION BY r.tmdb_id) as resource_count
        FROM xx_resources r
        JOIN xx_tmdb_cache t ON t.tmdb_id = r.tmdb_id
        WHERE r.access_level='vip'
          AND r.status='active'
          AND r.tmdb_id IS NOT NULL
          AND r.tmdb_id != ''
          AND r.tmdb_id NOT IN ('NOMATCH', 'SKIP')
          AND t.release_date IS NOT NULL
          AND (${isAll} OR t.tmdb_type = ${type})
          AND EXISTS (
            SELECT 1 FROM xx_vip_links l
            JOIN xx_vip_resources v ON l.resource_id = v.id
            WHERE v.tmdb_id = r.tmdb_id::int
              AND l.status = 'ok'
              AND l.play_url IS NOT NULL
          )
      )
      SELECT
        resource_id, tmdb_id, source, category, access_level,
        tmdb_title, title_zh, original_title, release_date, tmdb_type,
        poster_path, vote_average, overview, resource_count
      FROM ranked
      WHERE rn = 1
      ORDER BY release_date DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    const totalRow = await sql`
      SELECT count(DISTINCT r.tmdb_id) as cnt
      FROM xx_resources r
      JOIN xx_tmdb_cache t ON t.tmdb_id = r.tmdb_id
      WHERE r.access_level='vip'
        AND r.status='active'
        AND r.tmdb_id IS NOT NULL
        AND r.tmdb_id != ''
        AND r.tmdb_id NOT IN ('NOMATCH', 'SKIP')
        AND t.release_date IS NOT NULL
        AND (${isAll} OR t.tmdb_type = ${type})
        AND EXISTS (
          SELECT 1 FROM xx_vip_links l
          JOIN xx_vip_resources v ON l.resource_id = v.id
          WHERE v.tmdb_id = r.tmdb_id::int
            AND l.status = 'ok'
            AND l.play_url IS NOT NULL
        )
    `;
    const total = parseInt(totalRow[0]?.cnt || '0');

    const items = rows.map((r: any) => ({
      resourceId: r.resource_id,
      tmdbId: r.tmdb_id,
      tmdbType: r.tmdb_type,
      title: r.title_zh || r.tmdb_title,
      originalTitle: r.original_title,
      releaseDate: r.release_date,
      posterPath: r.poster_path,
      posterUrl: r.poster_path ? `${TMDB_IMAGE_BASE}${r.poster_path}` : null,
      voteAverage: r.vote_average ? parseFloat(r.vote_average) : null,
      overview: r.overview,
      source: r.source,
      resourceCount: parseInt(r.resource_count || '1'),
      accessLevel: r.access_level,
      category: r.category,
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
