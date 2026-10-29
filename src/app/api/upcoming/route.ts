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

// 2026-10-29: 模块级 TTL 缓存 (首页首屏调用, 实测线上 2.4 秒)
//   数据源 xx_upcoming (后台同步的即将上映表) + LEFT JOIN xx_resources
//   不依赖用户身份 → 可安全全局缓存; TTL 60 秒, 保证新上架能较快出现
const CACHE_TTL = 60 * 1000;
const CACHE_MAX = 100;
const cache = new Map<string, { at: number; body: any }>();

export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '', {
    fetchOptions: { cache: 'no-store' },
  });

  const sp = req.nextUrl.searchParams;
  const type = (sp.get('type') || 'all').toLowerCase(); // 'movie' / 'tv' / 'all'
  const page = parseInt(sp.get('page') || '1');
  const pageSize = Math.min(parseInt(sp.get('pageSize') || '30'), 100);

  // 2026-10-29: 缓存命中直接返
  const cacheKey = `${type}:${page}:${pageSize}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return NextResponse.json(hit.body, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'X-Cache': 'HIT' },
    });
  }

  try {
    // type 是 'movie' / 'tv' / 'all', 安全过滤 (枚举白名单)
    const isMovie = type === 'movie';
    const isTv = type === 'tv';
    const isAll = type === 'all';

    // LEFT JOIN xx_resources 看匹配
    // 2026-08-06: 加 r.type=u.tmdb_type 匹配 (兼容 type 准确的新数据)
    // + r.category 白名单兜底 (兼容 type=NULL 的老数据)
    // 修 BUG: 记忆管理局 (id=1039882) type=tv 但 category 误填'电影', 原 SQL 不匹配
    // 2026-10-29 🔥 修「最新上映」section 的未来日期问题
    //   xx_upcoming.release_date 可能有**未来日期** (TMDB 给未上映/重映标的档期)
    //   实测: '魔发奇缘'(2010) 的 release_date='2028-03-30' → 卡片年份显示 2028, 明显不对
    //   → 未来日期一律抹掉 (不显示年份), 且不参与排序
    const TODAY = new Date().toISOString().slice(0, 10);
    const rows = await sql`
      SELECT
        u.id,
        u.tmdb_id,
        u.tmdb_type,
        u.title,
        u.original_title,
        CASE WHEN u.release_date::text <= ${TODAY}
             THEN u.release_date::text
             ELSE NULL END as release_date,
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
        AND (
          (u.tmdb_type = 'movie' AND (r.type = 'movie' OR r.category IN ('电影','原盘','REMUX','系列电影')))
          OR (u.tmdb_type = 'tv' AND (r.type = 'tv' OR r.category IN ('剧集','动漫','综艺','纪录片')))
        )
      WHERE u.status = 'active'
        AND (${isAll} OR u.tmdb_type = ${type})
      ORDER BY
        -- 未来日期排最后 (未上映的放后面, 已上映的按上映日倒序)
        CASE WHEN u.release_date::text > ${TODAY} THEN 1 ELSE 0 END ASC,
        u.release_date DESC NULLS LAST,
        u.vote_average DESC NULLS LAST
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

    const body = { total, page, pageSize, type, items };

    // 2026-10-29: 写缓存
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(cacheKey, { at: Date.now(), body });

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Cache': 'MISS',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
