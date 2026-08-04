// 2026-08-04 P9.3: /api/vip/[id] 拿真视频源 (playerla + m3u8)
//   - 老业务用 xx_vip_resources + xx_vip_links 存 playerla iframe + m3u8 真链
//   - xx_resources.link 只是网盘分享链接, **不能**塞给 playerla iframe 嵌 (会显示网盘登录页 / X-Frame-Options 拒)
//   - 必须用 tmdb_id JOIN 两套表拿数据
//   - 拿不到 playerla link 时**不要兜底用主表网盘链接**! 返空 links, 前端显示"暂无播放链接"
//
// 关联链:
//   xx_resources.tmdb_id (新表, 26万 vip 资源, id = resourceId)
//   → xx_vip_resources.tmdb_id (老表, 2万 vip_resources, 存 playerla video source)
//   → xx_vip_links.resource_id (links 表, 存 play_url + m3u8 真链)

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

    // 1) 拿主资源 (xx_resources) - 基本元数据
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

    // 2) 拿 TMDB 详情 (xx_tmdb_cache 查海报/简介/评分)
    //    type: 'movie' | 'tv' | 'anime' | 'doc' | 'variety' | 'concert' → tmdb_type
    const tmdbType = ['tv', 'anime', 'variety', 'doc'].includes(head.type) ? 'tv' : 'movie';
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

    // 3) 拿真视频源 - xx_vip_resources (by tmdb_id) → xx_vip_links (by resource_id)
    //    老业务: playerla iframe URL + m3u8 真链
    //    xx_vip_resources.tmdb_id 是 integer, head.tmdb_id 是 text, 必须 ::int cast
    const vipRes = head.tmdb_id
      ? await sql`SELECT id FROM xx_vip_resources WHERE tmdb_id = ${String(head.tmdb_id)}::int LIMIT 1`
      : [];
    const vipResourceId = vipRes[0]?.id;

    const links: any[] = [];

    if (vipResourceId) {
      // 3a) 从 xx_vip_links 拿 playerla URL + m3u8 真链
      const vipLinks = await sql`
        SELECT id, source, play_url, m3u8_urls, season, episode, episode_title, status
        FROM xx_vip_links
        WHERE resource_id = ${vipResourceId}::bigint
          AND status = 'ok'
        ORDER BY season NULLS FIRST, episode NULLS FIRST, id ASC
        LIMIT 30
      `;

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
          id: Number(l.id) + 100000,  // 跟主表 link 区分
          source: l.source,
          status: l.status,
          playUrl: l.play_url,  // playerla iframe URL!
          m3u8Urls: m3u8Urls,    // m3u8 真链数组
          season: l.season ? Number(l.season) : null,
          episode: l.episode ? Number(l.episode) : null,
          episodeTitle: l.episode_title,
          lastOkAt: null,
          password: null,
        });
      }
    }

    // 3b) 兜底: xx_resource_links (新表 1对N 资源, 极少数)
    //   - 这种 link 是网盘分享 (aliyun/baidu/quark), 跟 3c 主表 link 性质一样
    //   - 都**不能**塞给 playerla iframe 嵌 (会崩)
    //   - 但至少能让前端显示 "下载链接" 备选
    if (links.length === 0) {
      const subLinkRows = await sql`
        SELECT id, source, url, password, sort, status, access_level, season, episode, created_at
        FROM xx_resource_links
        WHERE resource_id = ${id}::int
          AND status = 'active'
        ORDER BY sort ASC, created_at DESC
        LIMIT 20
      `;
      for (const l of subLinkRows) {
        // 标记为 'download' 模式, 前端用下载链接展示而不是 iframe 嵌
        links.push({
          id: Number(l.id),
          source: l.source,
          status: l.status,
          playUrl: l.url,
          m3u8Urls: [],
          season: l.season ? Number(l.season) : null,
          episode: l.episode ? Number(l.episode) : null,
          episodeTitle: null,
          lastOkAt: l.created_at,
          password: l.password,
          mode: 'download',  // 告诉前端用下载按钮展示, 不用 iframe
        });
      }

      // 3c) 主表 link 兜底 (网盘分享, 跟 3b 一样, 标记 download 模式)
      //   2026-08-04 P9.3: 不再塞给 playerla iframe 嵌 (会显示网盘登录页崩应用)
      if (links.length === 0 && head.main_link) {
        links.push({
          id: Number(head.id),
          source: head.source || 'other',
          status: head.status,
          playUrl: head.main_link,
          m3u8Urls: [],
          season: null,
          episode: null,
          episodeTitle: null,
          lastOkAt: null,
          password: head.link_code || null,
          mode: 'download',  // 标记下载模式, 不 iframe
        });
      }
    }

    return NextResponse.json({
      ok: true,
      // 2026-08-04 P9.3: 告诉前端当前 link 来源
      //   - 'player' 模式: 有 playerla iframe 或 m3u8 真链 → 走 PlayerStage 视频播放
      //   - 'download' 模式: 只有网盘分享链接 → 显示下载按钮, 不要 iframe 嵌
      //   - 'none' 模式: 没有任何 link
      linkMode: links.length === 0 ? 'none' : (links[0].mode === 'download' ? 'download' : 'player'),
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
