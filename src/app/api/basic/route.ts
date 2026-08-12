// 2026-08-03: P3 basic 专区 API
//   - 泽泽妈 115 文档 (import_channel='zezhe') 已匹配 tmdbid 的资源
//   - JOIN xx_tmdb_cache 拿 release_date + poster + overview
//   - 按 release_date DESC 排序 (近→远)
//   - DISTINCT ON (tmdb_id) 去重 (1 个 tmdb 多个网盘只显示 1 张卡)
//   - 角标: 电影/剧集 + 资源数 (1/N 网盘) + access_level
//   - type 过滤: 'all' / 'movie' / 'tv'

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

    // 2026-08-12 修: 改用 GROUP BY 简化版, 旧版 DISTINCT ON + nested subquery 在 Neon HTTP endpoint 实际跑 38s (EXPLAIN 92ms 不准)
    //   GROUP BY 1.8s, 加速 20x
    //   业务: GROUP BY tmdb_id 拿每个 tmdb 第 1 条 + 资源数 count, 按 release_date DESC
    const rows = await sql`
      SELECT
        r.tmdb_id,
        t.title_zh, t.tmdb_type, t.release_date, t.poster_path, t.vote_average, t.overview,
        MIN(r.id) as resource_id,
        MIN(r.source) as source,
        MIN(r.category) as category,
        MIN(r.access_level) as access_level,
        MIN(r.name) as resource_name,
        COUNT(*) as resource_count
      FROM xx_resources r
      JOIN xx_tmdb_cache t ON t.tmdb_id = r.tmdb_id
      WHERE r.import_channel='zezhe'
        AND r.status='active'
        AND r.tmdb_id IS NOT NULL
        AND r.tmdb_id != ''
        AND r.tmdb_id != 'NOMATCH'
        AND t.release_date IS NOT NULL
        AND (${isAll} OR t.tmdb_type = ${type})
      GROUP BY r.tmdb_id, t.title_zh, t.tmdb_type, t.release_date, t.poster_path, t.vote_average, t.overview
      ORDER BY t.release_date DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    const totalRow = await sql`
      SELECT count(DISTINCT r.tmdb_id) as cnt
      FROM xx_resources r
      JOIN xx_tmdb_cache t ON t.tmdb_id = r.tmdb_id
      WHERE r.import_channel='zezhe'
        AND r.status='active'
        AND r.tmdb_id IS NOT NULL
        AND r.tmdb_id != ''
        AND r.tmdb_id != 'NOMATCH'
        AND t.release_date IS NOT NULL
        AND (${isAll} OR t.tmdb_type = ${type})
    `;
    const total = parseInt(totalRow[0]?.cnt || '0');

    const items = rows.map((r: any) => ({
      resourceId: r.resource_id,
      tmdbId: r.tmdb_id,
      tmdbType: r.tmdb_type,
      title: r.title_zh || r.resource_name,
      releaseDate: r.release_date,
      posterPath: r.poster_path,
      // 2026-08-12 修: 兼容 poster_path 可能是完整 URL (8-12 测试发现 cache 里部分 row 已存完整 URL)
      //   否则会拼成 'https://image.tmdb.org/t/p/w500https://image.tmdb.org/t/p/w500/...' (重复 base)
      posterUrl: r.poster_path
        ? (r.poster_path.startsWith('http') ? r.poster_path : `${TMDB_IMAGE_BASE}${r.poster_path}`)
        : null,
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
