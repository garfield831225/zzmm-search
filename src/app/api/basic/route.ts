// 2026-08-03: P3 basic 专区 API
//   - 泽泽妈 115 文档 (import_channel='zezhe') 已匹配 tmdbid 的资源
//   - JOIN xx_tmdb_cache 拿 release_date + poster + overview
//   - 排序: 默认 release_date DESC (近期优先); sort=rating 用 vote_average DESC
//   - GROUP BY tmdb_id 去重 (1 个 tmdb 多个网盘只显示 1 张卡, resource_count 计数)
//   - 2026-10-16 P12: 加 5 行筛选 (category/source/region/year/matchStatus) + SORT + Per Page
//   - 鉴权: 跟 /api/search 一致 - basic 看全部, vip/admin 全开

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

import { recordClick } from '@/lib/track-click';  // 2026-10-20 异常用户登录: 全 API 点击计数
import { tmdbImageUrl } from '@/lib/tmdb-image';  // 2026-10-29: 图片统一走 CF 边缘反代
neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_IMAGE_BASE = 'https://image.zzmm-search.uk/t/p/w500';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// 2026-10-29: 模块级 TTL 缓存 (首页首屏 + /basic 页都调这个, 实测线上 3 秒)
//   只缓存"重 SQL + 结果映射"部分:
//   - userGroup 不参与 WHERE → 返回结果与用户身份无关 → 可安全全局共享
//   - 鉴权解析 + recordClick 点击计数照常执行 (不放进缓存), 反滥用统计不受影响
const QUERY_CACHE_TTL = 60 * 1000;  // 60 秒
const QUERY_CACHE_MAX = 300;
const queryCache = new Map<string, { at: number; total: number; items: any[] }>();

// source 显示名 → key 映射 (跟 /api/search 对齐)
const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '夸克网盘': 'quark', '123网盘': '123', '天翼云盘': 'tianyi',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k', '迅雷链接': 'thunder',
};
// 地区 → 国家代码 (跟 /api/search REGION_CODES 一致)
const REGION_CODES: Record<string, string[]> = {
  '大陆': ['CN'],
  '欧美': ['US', 'GB', 'FR', 'DE', 'IT', 'ES', 'CA', 'AU', 'NZ'],
  '日韩': ['JP', 'KR'],
  '港澳台': ['HK', 'TW', 'MO'],
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '', {
    fetchOptions: { cache: 'no-store' },
  });

  const sp = req.nextUrl.searchParams;
  // 兼容老参数 type (all/movie/tv) — 当作 category 简化版
  const type = (sp.get('type') || 'all').toLowerCase();
  const category = sp.get('category') || (type === 'movie' ? '电影' : type === 'tv' ? '剧集' : '全部');
  const source = sp.get('source') || '';
  const region = sp.get('region') || '';
  const year = sp.get('year') || '';
  const matchStatus = sp.get('matchStatus') || '';
  const sort = sp.get('sort') || 'release_date';
  const page = parseInt(sp.get('page') || '1');
  const pageSize = Math.min(parseInt(sp.get('pageSize') || '30'), 150);

  try {
    // 鉴权 (跟 /api/search 对齐 - basic 看全部, 不卡 access_level)
    let userGroup: string = 'user';
    try {
      const authHeader = req.headers.get('authorization');
      let token: string | null = null;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.replace('Bearer ', '');
      } else {
        token = req.cookies.get('zzmm_token')?.value || null;
      }
      if (token) {
        const payload = jwt.verify(token, (process.env.JWT_SECRET || 'cLWhs2015')) as any;
        const userId = String(payload.id);      // 2026-10-20: 全 API 点击计数 (fire-and-forget)
      void recordClick(req, Number(payload.id));

        const uRow = await sql`SELECT user_group FROM xx_users WHERE id = ${userId} LIMIT 1`;
        if (uRow[0]?.user_group) userGroup = String(uRow[0].user_group).toLowerCase();
      }
    } catch { /* 未登录 user */ }

    // ── WHERE 条件 ──
    const conds: string[] = ['r.import_channel=\'zezhe\'', 'r.status=\'active\'', 'r.tmdb_id IS NOT NULL', 'r.tmdb_id != \'\'', 'r.tmdb_id != \'NOMATCH\'', 't.release_date IS NOT NULL'];
    const condVals: any[] = [];
    const addCond = (condSQL: string, ...vals: any[]) => {
      const offset = condVals.length;
      const renum = condSQL.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + offset}`);
      conds.push(renum);
      condVals.push(...vals);
    };

    // category 过滤 (兼容老 type)
    if (category !== '全部' && category !== 'all') {
      // '电影' 走 tmdb_type='movie', 其他按 doc_sheet/category 精确匹配
      if (category === '电影' || category === 'movie') {
        addCond('t.tmdb_type = $1', 'movie');
      } else if (category === '剧集' || category === 'tv') {
        addCond('t.tmdb_type = $1', 'tv');
      } else {
        addCond('r.category = $1', category);
      }
    }

    // source 过滤
    if (source && source !== '全部') {
      addCond('r.source = $1', SOURCE_KEY_MAP[source] || source);
    }

    // year 过滤 (按 release_date)
    if (year && year !== '全部') {
      if (['2026','2025','2024','2023','2022','2021','2020'].includes(year)) {
        addCond('t.release_date LIKE $1', year + '-%');
      } else if (year === '2010-2019') {
        conds.push("t.release_date >= '2010-01-01' AND t.release_date <= '2019-12-31'");
      } else if (year === '2000-2009') {
        conds.push("t.release_date >= '2000-01-01' AND t.release_date <= '2009-12-31'");
      }
    }

    // region 过滤 (按 origin_country)
    const regionCodes = REGION_CODES[region];
    if (regionCodes) {
      const regionParts: string[] = ["t.origin_country IS NOT NULL AND t.origin_country <> ''"];
      for (const c of regionCodes) {
        const offset = condVals.length;
        regionParts.push(`(t.origin_country LIKE $${offset + 1})`);
        condVals.push('%' + c + '%');
      }
      conds.push('(' + regionParts.join(' OR ') + ')');
    }

    // matchStatus 过滤 (TMDB 已匹配 = tmdb_id 是 10000+ 数字)
    if (matchStatus === '已批配') {
      conds.push("(r.tmdb_id ~ '^[0-9]+$' AND (r.tmdb_id)::int > 10000)");
    } else if (matchStatus === '未匹配') {
      // basic API 已经过滤 r.tmdb_id IS NOT NULL, 剩余的都是"未匹配 10+ 位"或非数字
      conds.push("(NOT (r.tmdb_id ~ '^[0-9]+$' AND (r.tmdb_id)::int > 10000))");
    }

    const whereSQL = 'WHERE ' + conds.join(' AND ');

    // ── 排序 ──
    // 2026-10-29 🔥 未来日期处理: TMDB 的 release_date 可能是未上映/重映档期 (如 2028-03-30)
    //   → 排序时排最后, 展示时不显示年份 (否则卡片显示 "2028" 明显不对)
    const TODAY = new Date().toISOString().slice(0, 10);
    let orderBy = `CASE WHEN t.release_date > '${TODAY}' THEN 1 ELSE 0 END ASC, t.release_date DESC NULLS LAST`;
    if (sort === 'added_time') {
      orderBy = 'MAX(r.created_at) DESC';
    } else if (sort === 'rating') {
      // 2026-10-16: 修 GROUP BY 缺 t.vote_count — 用 MAX 聚合 (每组就 1 个)
      orderBy = `COALESCE(NULLIF(t.vote_average, '')::numeric, 0) DESC NULLS LAST, MAX(NULLIF(t.vote_count, '')::int) DESC NULLS LAST, CASE WHEN t.release_date > '${TODAY}' THEN 1 ELSE 0 END ASC, t.release_date DESC NULLS LAST`;
    }

    // 2026-10-29: 缓存命中直接返 (跳过 COUNT DISTINCT + GROUP BY 重查询, 实测 3 秒 → 毫秒级)
    const cacheKey = `${whereSQL}|${JSON.stringify(condVals)}|${orderBy}|${page}|${pageSize}`;
    const hit = queryCache.get(cacheKey);
    if (hit && Date.now() - hit.at < QUERY_CACHE_TTL) {
      return NextResponse.json({
        total: hit.total,
        page,
        pageSize,
        category,
        source,
        region,
        year,
        matchStatus,
        sort,
        items: hit.items,
      }, {
        headers: {
          ...CORS_HEADERS,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Cache': 'HIT',
        },
      });
    }

    // ── Count (distinct tmdb) ──
    const countSQL = `SELECT COUNT(DISTINCT r.tmdb_id) as cnt FROM xx_resources r JOIN xx_tmdb_cache t ON t.tmdb_id = r.tmdb_id ${whereSQL}`;
    const countRows = await sql(countSQL, condVals) as any[];
    const total = parseInt(countRows?.[0]?.cnt || '0');

    // ── List (GROUP BY tmdb_id) ──
    const listSQL = `
      SELECT
        r.tmdb_id,
        t.title_zh, t.tmdb_type, t.release_date, t.poster_path, t.vote_average, t.overview,
        MIN(r.id) as resource_id,        MIN(r.source) as source,
        MIN(r.category) as category,
        MIN(r.access_level) as access_level,
        MIN(r.name) as resource_name,
        COUNT(*) as resource_count,
        BOOL_OR(r.name ILIKE '%短剧%' OR array_to_string(r.tags, ',') ILIKE '%短剧%') as is_short_drama
      FROM xx_resources r
      JOIN xx_tmdb_cache t ON t.tmdb_id = r.tmdb_id
      ${whereSQL}
      GROUP BY r.tmdb_id, t.title_zh, t.tmdb_type, t.release_date, t.poster_path, t.vote_average, t.overview
      ORDER BY ${orderBy}
      LIMIT $${condVals.length + 1} OFFSET $${condVals.length + 2}
    `;
    const rows = await sql(listSQL, [...condVals, pageSize, (page - 1) * pageSize]) as any[];

    const items = rows.map((r: any) => ({
      resourceId: r.resource_id,
      tmdbId: r.tmdb_id,
      tmdbType: r.tmdb_type,
      title: r.title_zh || r.resource_name,
      releaseDate: r.release_date && r.release_date <= TODAY ? r.release_date : '',
      posterPath: r.poster_path,
      // 2026-10-29: 统一走 tmdbImageUrl (库里 22238 条 poster_path 是完整 URL, 原来会直连 image.tmdb.org → 12 秒/张)
      posterUrl: r.poster_path ? tmdbImageUrl(r.poster_path, 'w500') : null,
      voteAverage: r.vote_average ? parseFloat(r.vote_average) : null,
      overview: r.overview,
      source: r.source,
      resourceCount: parseInt(r.resource_count || '1'),
      accessLevel: r.access_level,
      category: r.category,
      isShortDrama: !!r.is_short_drama,
    }));

    // 2026-10-29: 写缓存 (超上限就清掉最旧的一批, 防无限增长)
    if (queryCache.size >= QUERY_CACHE_MAX) {
      const oldest = queryCache.keys().next().value;
      if (oldest !== undefined) queryCache.delete(oldest);
    }
    queryCache.set(cacheKey, { at: Date.now(), total, items });

    return NextResponse.json({
      total,
      page,
      pageSize,
      category,
      source,
      region,
      year,
      matchStatus,
      sort,
      items,
    }, {
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Cache': 'MISS',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500, headers: CORS_HEADERS });
  }
}