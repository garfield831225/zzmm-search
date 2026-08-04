// 2026-08-04: P9 /vip/[id] 详情页改用 xx_resources + xx_resource_links
//   - 跟 /api/vip 列表一致 (P4 改动后)
//   - id 跟 /api/vip 列表的 resourceId 对得上
//   - 用 xx_resource_links 拿播放链接 (原 vip_links 表 id 跟新表不对)
//
// 返回: TMDB 详情 + 该资源所有可用播放链接
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_IMG = 'https://image.tmdb.org/t/p';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  if (!id || isNaN(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 1) 拿主资源 (xx_resources)
    //    type 字段: 'movie' | 'tv' | 'anime' | 'doc' | 'variety' | 'concert' 等
    //    tmdb_id 字段是 text 类型
    const rows = await sql`SELECT
        r.id, r.name AS title, r.tmdb_id, r.type, r.source,
        r.category, r.access_level, r.status,
        r.link AS main_link, r.link_code
      FROM xx_resources r
      WHERE r.id = ${id}::int
      LIMIT 1`;

    if (!rows.length) {
      return NextResponse.json({ error: '资源不存在' }, { status: 404 });
    }
    const head = rows[0] as any;
    if (head.access_level !== 'vip') {
      return NextResponse.json({ error: '非 VIP 资源' }, { status: 403 });
    }

    // 2) 拿链接 (主表 link 字段 + 副表 xx_resource_links 都查)
    //    大多数资源 link 还在 xx_resources.link 主字段, 副表只放 1对N 资源
    const linkRows: any[] = [];

    // 2a) 主表 link (主 link, 优先级最高)
    if (head.main_link) {
      linkRows.push({
        id: Number(head.id) * 1000,  // 虚拟 id 避免冲突
        source: head.source || 'other',
        status: head.status,
        playUrl: head.main_link,
        season: null,
        episode: null,
        episodeTitle: null,
        lastOkAt: null,
        password: head.link_code || null,
      });
    }

    // 2b) 副表 xx_resource_links (1对N 资源的多网盘)
    const subLinkRows = await sql`
      SELECT id, source, url, password, sort, status, access_level, season, episode, created_at
      FROM xx_resource_links
      WHERE resource_id = ${id}::int
        AND status = 'active'
      ORDER BY sort ASC, created_at DESC
      LIMIT 20
    `;
    for (const l of subLinkRows) {
      linkRows.push({
        id: Number(l.id),
        source: l.source,
        status: l.status,
        playUrl: l.url,
        season: l.season ? Number(l.season) : null,
        episode: l.episode ? Number(l.episode) : null,
        episodeTitle: null,
        lastOkAt: l.created_at,
        password: l.password,
      });
    }

    // 3) 拿 TMDB 详情 (xx_tmdb_cache 查海报/简介/评分)
    const tmdbType = head.type === 'tv' || head.type === 'anime' || head.type === 'variety' || head.type === 'doc'
      ? 'tv' : 'movie';
    const tmdb = head.tmdb_id
      ? await sql`
        SELECT title, title_zh, original_title, overview, poster_path, backdrop_path,
               vote_average, vote_count, release_date, genres
        FROM xx_tmdb_cache
        WHERE tmdb_id = ${String(head.tmdb_id)}::text AND tmdb_type = ${tmdbType}
        LIMIT 1
      `
      : [];
    const tmdbData = tmdb[0] || {};

    // 4) 拼装 links (前端 playerla 播放用)
    const links = linkRows;

    return NextResponse.json({
      ok: true,
      resource: {
        id: Number(head.id),
        tmdbId: head.tmdb_id,
        mediaType: tmdbType,
        title: tmdbData.title_zh || tmdbData.title || head.title,
        originalTitle: tmdbData.original_title,
        originalLanguage: null,
        overview: tmdbData.overview,
        source: head.source,
        posterUrl: tmdbData.poster_path
          ? (tmdbData.poster_path.startsWith('http') ? tmdbData.poster_path : `${TMDB_IMG}/w500${tmdbData.poster_path}`)
          : null,
        backdropUrl: tmdbData.backdrop_path
          ? (tmdbData.backdrop_path.startsWith('http') ? tmdbData.backdrop_path : `${TMDB_IMG}/w1280${tmdbData.backdrop_path}`)
          : null,
        voteAverage: tmdbData.vote_average ? Number(tmdbData.vote_average) : null,
        voteCount: tmdbData.vote_count ? Number(tmdbData.vote_count) : 0,
        releaseDate: tmdbData.release_date || null,
        popularity: 0,
        genreIds: tmdbData.genres || [],
        seasonCount: null,
        episodeCount: null,
        status: null,
        runtime: null,
        adult: false,
      },
      links,
      hasLinks: links.length > 0,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
