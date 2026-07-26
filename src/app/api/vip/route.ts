// 2026-07-24 zzmm-vip 影视区 - 列表 API
// 鉴权: 必须 basic/vip/admin (走 JWT payload.group, 跟 middleware 一致)
// 排序: 有播放链接的优先, 再按 popularity desc
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';
const ALLOWED = new Set(['basic', 'vip', 'admin']);

function getGroup(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ')
    ? auth.replace('Bearer ', '')
    : req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return payload?.group || null;
  } catch {
    return null;
  }
}

const TMDB_IMG = 'https://image.tmdb.org/t/p';

export async function GET(req: NextRequest) {
  const group = getGroup(req);
  if (!group || !ALLOWED.has(group)) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  const url = new URL(req.url);
  const mediaType = url.searchParams.get('mediaType') || '';   // '' | 'movie' | 'tv'
  const hasLink = url.searchParams.get('hasLink');              // '1' = 只看有链接
  const sort = url.searchParams.get('sort') || 'smart';         // 'smart' | 'popular' | 'rating' | 'newest'
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);  // 2026-07-26: 搜索关键词 (限制 100 字)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '48', 10)));
  const offset = (page - 1) * pageSize;

  try {
    const sql = neon(process.env.DATABASE_URL || '');

    // 数字参数手工拼 (避免 $1 顺序错乱 + 跟现有代码风格一致)
    // 注意: pageSize/offset 是数字, 已经 parseInt, 直接拼安全
    // mediaType 是字符串白名单, 拼字符串安全
    const safeMediaType = (mediaType === 'movie' || mediaType === 'tv') ? mediaType : '';
    const onlyLinked = hasLink === '1';

    const conds: string[] = [];
    if (safeMediaType) conds.push(`r.media_type = '${safeMediaType}'`);
    if (q) {
      // ILIKE 模糊匹配 title + original_title, 数字走 = (TMDB ID 直查)
      const isNumeric = /^\d+$/.test(q);
      if (isNumeric) {
        conds.push(`(r.tmdb_id = ${parseInt(q)} OR r.title ILIKE '%${q.replace(/'/g, "''")}%' OR r.original_title ILIKE '%${q.replace(/'/g, "''")}%')`);
      } else {
        conds.push(`(r.title ILIKE '%${q.replace(/'/g, "''")}%' OR r.original_title ILIKE '%${q.replace(/'/g, "''")}%')`);
      }
    }
    if (onlyLinked) conds.push(`l.id IS NOT NULL`);
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    let orderBy = '';
    switch (sort) {
      case 'popular':
        orderBy = 'r.popularity DESC NULLS LAST';
        break;
      case 'rating':
        orderBy = 'r.vote_score DESC NULLS LAST, r.vote_count DESC';
        break;
      case 'newest':
        orderBy = 'COALESCE(r.release_date, r.first_air_date) DESC NULLS LAST';
        break;
      case 'smart':
      default:
        // 2026-07-26: 整体排序 (有 link 全放一起, 再放没 link), 不能分页错位
        // 用 EXISTS 子查询, 避免 LEFT JOIN 影响 sort 性能
        orderBy = `EXISTS(SELECT 1 FROM xx_vip_links l WHERE l.resource_id = r.id AND l.status = 'ok') DESC, r.popularity DESC NULLS LAST`;
    }

    // 2026-07-25: 拆 count + list + links 三段查询, 避免 LEFT JOIN 子查询每行跑一次
    // 1. count
    const countWhere = conds.length ? 'WHERE ' + conds.filter(c => !c.includes('l.id IS NOT NULL')).join(' AND ') : '';
    const totalRows = await sql(`SELECT COUNT(*) as c FROM xx_vip_resources r ${countWhere}`);
    const total = parseInt(totalRows[0]?.c || '0');

    // 2. 主页资源 (按 sort 排序, paginated) - 整体排序, 不分页错位
    const resourceQuery = `
      SELECT
        r.id, r.tmdb_id, r.media_type, r.title, r.original_title,
        r.poster_path, r.backdrop_path, r.vote_average, r.vote_count,
        r.release_date, r.first_air_date, r.popularity, r.genre_ids,
        r.season_count, r.episode_count, r.status, r.updated_at
      FROM xx_vip_resources r
      ${countWhere}
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const resourceRows = await sql(resourceQuery) as any[];

    // 2026-07-26: 全站可播放统计 (不受 filter 影响, 前端顶栏展示)
    const globalStatsRows = await sql(`
      SELECT
        COUNT(*)::int AS total_resources,
        COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM xx_vip_links l WHERE l.resource_id = r.id AND l.status = 'ok'))::int AS playable_resources
      FROM xx_vip_resources r
    `);
    const globalStats = {
      totalResources: globalStatsRows[0]?.total_resources || 0,
      playableResources: globalStatsRows[0]?.playable_resources || 0,
    };

    if (resourceRows.length === 0) {
      return NextResponse.json({ ok: true, page, pageSize, total, hasMore: false, items: [], globalStats });
    }

    // 3. 拿每个 resource 最新的 link (DISTINCT ON + ANY 一次拿全)
    const resourceIds = resourceRows.map(r => r.id);
    const linkRows = await sql`
      SELECT DISTINCT ON (resource_id)
        resource_id, id AS link_id, play_url, source, status AS link_status, last_ok_at
      FROM xx_vip_links
      WHERE resource_id = ANY(${resourceIds})
        AND status = 'ok'
      ORDER BY resource_id, last_ok_at DESC NULLS LAST, id ASC
    `;
    const linkMap = new Map();
    for (const l of (linkRows || [])) {
      linkMap.set(l.resource_id, l);
    }

    // 4. 合并 link 数据 (排序在 SQL 端已搞定, 这里不再应用层 sort)
    const rows = resourceRows.map(r => {
      const l = linkMap.get(r.id);
      return {
        ...r,
        link_id: l?.link_id || null,
        play_url: l?.play_url || null,
        link_source: l?.source || null,
        link_status: l?.link_status || null,
        last_ok_at: l?.last_ok_at || null,
      };
    });
    // 2026-07-26: 不再应用层 sort - SQL 端 EXISTS 整体排序, 全表 370 个有 link 全放最前

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
      globalStats,  // 2026-07-26: 全站可播放统计 (不受 filter 影响)
      items: rows.map((r) => ({
        id: Number(r.id),
        tmdbId: Number(r.tmdb_id),
        mediaType: r.media_type,
        title: r.title,
        originalTitle: r.original_title,
        posterUrl: r.poster_path ? `${TMDB_IMG}/w500${r.poster_path}` : null,
        backdropUrl: r.backdrop_path ? `${TMDB_IMG}/w1280${r.backdrop_path}` : null,
        voteAverage: r.vote_average ? Number(r.vote_average) : null,
        voteCount: r.vote_count ? Number(r.vote_count) : 0,
        releaseDate: r.release_date || r.first_air_date || null,
        popularity: r.popularity ? Number(r.popularity) : 0,
        genreIds: r.genre_ids || [],
        seasonCount: r.season_count ? Number(r.season_count) : null,
        episodeCount: r.episode_count ? Number(r.episode_count) : null,
        status: r.status,
        hasLink: !!r.link_id,
        link: r.link_id
          ? {
              id: Number(r.link_id),
              playUrl: r.play_url,
              source: r.link_source,
              season: r.link_season,
              episode: r.link_episode,
              lastOkAt: r.last_ok_at,
            }
          : null,
      })),
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '查询失败' }, { status: 500 });
  }
}
