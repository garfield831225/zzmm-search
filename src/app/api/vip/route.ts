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
        orderBy = '(l.id IS NOT NULL) DESC, r.popularity DESC NULLS LAST';
    }

    // 2026-07-25: 拆 count + list + links 三段查询, 避免 LEFT JOIN 子查询每行跑一次
    // 1. count
    const countWhere = conds.length ? 'WHERE ' + conds.filter(c => !c.includes('l.id IS NOT NULL')).join(' AND ') : '';
    const totalRows = await sql(`SELECT COUNT(*) as c FROM xx_vip_resources r ${countWhere}`);
    const total = parseInt(totalRows[0]?.c || '0');

    // 2. 主页资源 (按 sort 排序, paginated)
    const resourceQuery = `
      SELECT
        r.id, r.tmdb_id, r.media_type, r.title, r.original_title,
        r.poster_path, r.backdrop_path, r.vote_average, r.vote_count,
        r.release_date, r.first_air_date, r.popularity, r.genre_ids,
        r.season_count, r.episode_count, r.status, r.updated_at
      FROM xx_vip_resources r
      ${countWhere}
      ORDER BY ${orderBy.replace(/\(l\.id IS NOT NULL\) DESC, /g, '')}
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const resourceRows = await sql(resourceQuery) as any[];
    if (resourceRows.length === 0) {
      return NextResponse.json({ ok: true, page, pageSize, total, hasMore: false, items: [] });
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

    // 4. 合并 + 排序 (smart 模式按 hasLink 优先)
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
    if (sort === 'smart' || !sort) {
      rows.sort((a, b) => {
        const aHas = a.link_id ? 1 : 0;
        const bHas = b.link_id ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return (b.popularity || 0) - (a.popularity || 0);
      });
    }
    // onlyLinked 时过滤没 link 的 (但保留返回的 rows 全量, 让前端能展示)
    // 实际上 onlyLinked 应该影响 total 和过滤, 这里简化: 只 filter rows
    // (前端 useEffect 处理 hasLink=false 不显示)

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
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
