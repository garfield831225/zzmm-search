// 2026-08-04 P9.5: /api/vip/[id] 直接查 xx_vip_resources (vip_resource.id = resourceId)
//   - 血教训 #25: 之前用 xx_resources.id 当 resourceId 配对, 但 xx_resources 跟 xx_vip_resources 是两条线
//   - 现在 /api/vip 列表返 resourceId = xx_vip_resources.id (vip_resource.id, bigint)
//   - /api/vip/[id] 直接查 xx_vip_resources WHERE id = ${id}
//   - xx_vip_links WHERE resource_id = ${id} 拿所有集 playerla URL + m3u8
//   - 拿不到 playerla link 时返空 links (前端显示"暂无播放链接")
//
// 关联链 (新版):
//   /api/vip 列表: v_xx_vip_resources_with_link view
//   /api/vip/[id] → xx_vip_resources.id = v.id
//                  → xx_vip_links.resource_id = xx_vip_resources.id

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

    // 2026-08-04 P9.5: 直接查 xx_vip_resources (id = resourceId)
    //   - /api/vip 列表返的 resourceId 来自 v_xx_vip_resources_with_link.id
    //   - 即 xx_vip_resources.id (bigint)
    const rows = await sql`SELECT
        v.id, v.tmdb_id, v.media_type, v.title, v.original_title,
        v.original_language, v.poster_path, v.backdrop_path, v.overview,
        v.vote_average, v.vote_count, v.release_date, v.first_air_date,
        v.genre_ids, v.status, v.season_count, v.episode_count, v.runtime
      FROM xx_vip_resources v
      WHERE v.id = ${id}::bigint
      LIMIT 1`;

    if (!rows.length) {
      return NextResponse.json({ error: '资源不存在' }, { status: 404 });
    }
    const head = rows[0] as any;

    // 拿所有 playerla 视频源 (一集一条, xx_vip_links 是 1对N 表)
    const vipLinks = await sql`
      SELECT id, source, play_url, m3u8_urls, season, episode, episode_title, status, last_ok_at
      FROM xx_vip_links
      WHERE resource_id = ${id}::bigint
        AND status = 'ok'
      ORDER BY season NULLS FIRST, episode NULLS FIRST, id ASC
      LIMIT 60
    `;

    const links: any[] = [];
    for (const l of vipLinks) {
      if (!l.play_url) continue;
      // 解析 m3u8_urls (jsonb 数组)
      let m3u8Urls: any[] = [];
      try {
        m3u8Urls = typeof l.m3u8_urls === 'string'
          ? JSON.parse(l.m3u8_urls)
          : (Array.isArray(l.m3u8_urls) ? l.m3u8_urls : []);
      } catch {}
      links.push({
        id: Number(l.id),
        source: l.source,
        status: l.status,
        playUrl: l.play_url,  // playerla iframe URL
        m3u8Urls: m3u8Urls,    // m3u8 真链数组
        season: l.season ? Number(l.season) : null,
        episode: l.episode ? Number(l.episode) : null,
        episodeTitle: l.episode_title,
        lastOkAt: l.last_ok_at,
        password: null,
      });
    }

    return NextResponse.json({
      ok: true,
      // P9.5: 现在 list 返的全是 v_xx_vip_resources_with_link 有 play_url 的资源
      //   - 有 link 就是 player 模式 (playerla iframe 优先, m3u8 fallback)
      //   - 拿不到 link 就是 none
      linkMode: links.length > 0 ? 'player' : 'none',
      resource: {
        id: Number(head.id),
        tmdbId: head.tmdb_id ? String(head.tmdb_id) : null,
        mediaType: head.media_type || 'movie',
        title: head.title || '未命名',
        originalTitle: head.original_title,
        originalLanguage: head.original_language,
        overview: head.overview,
        source: 'xingfan',
        posterUrl: head.poster_path
          ? (head.poster_path.startsWith('http') ? head.poster_path : `${TMDB_IMG}/w500${head.poster_path}`)
          : null,
        backdropUrl: head.backdrop_path
          ? (head.backdrop_path.startsWith('http') ? head.backdrop_path : `${TMDB_IMG}/w1280${head.backdrop_path}`)
          : null,
        voteAverage: head.vote_average ? Number(head.vote_average) : null,
        voteCount: head.vote_count ? Number(head.vote_count) : 0,
        releaseDate: head.release_date || head.first_air_date || null,
        popularity: 0,
        genreIds: Array.isArray(head.genre_ids) ? head.genre_ids : [],
        seasonCount: head.season_count ? Number(head.season_count) : null,
        episodeCount: head.episode_count ? Number(head.episode_count) : null,
        status: head.status,
        runtime: head.runtime ? Number(head.runtime) : null,
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
