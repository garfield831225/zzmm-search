export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const TMDB_KEY = process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd';
const TMDB_BASE = 'https://api.themoviedb.org/3';

const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '夸克网盘': 'quark', '123网盘': '123', '天翼云盘': 'tianyi',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k', '迅雷链接': 'thunder',
};
const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};
const CATEGORIES = ['全部', '连载', '电影', '剧集', '动漫', '少儿频道', '综艺', '演唱会', '纪录片', '原盘', 'REMUX', '系列电影'];
const NONFILM_CATEGORIES = ['全部', '音乐', '体育', '游戏', '电子书', '精品课', '文档'];
const NONFILM_CATS = ['音乐', '体育', '游戏', '电子书', '精品课', '文档'];

// 地区标签 -> 国家代码
const REGION_CODES: Record<string, string[]> = {
  '大陆': ['CN'],
  '欧美': ['US', 'GB', 'FR', 'DE', 'IT', 'ES', 'CA', 'AU', 'NZ'],
  '日韩': ['JP', 'KR'],
  '港澳台': ['HK', 'TW', 'MO'],
};

// 参考 src/app/api/cron/match-task/route.ts getTypesForCategory，禁止自行"优化"
function getTypesForCategory(category: string, subType: string | null): string[] | null {
  if (category === '连载' || category === '剧集' || category === '动漫' || category === '少儿频道' || category === '综艺') return ['tv'];
  if (category === '演唱会' || category === '电影' || category === '系列电影') return ['movie'];
  if (category === '纪录片') return ['tv', 'movie'];
  if (category === '原盘') {
    if (['电影', '动画电影', '演唱会', '3D原盘'].includes(subType || '')) return ['movie'];
    return ['tv'];
  }
  if (category === 'REMUX') return ['movie'];
  return null;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function searchTMDBByType(q: string, type: string, lang = 'zh-CN') {
  const url = `${TMDB_BASE}/search/${type}?query=${encodeURIComponent(q)}&api_key=${TMDB_KEY}&language=${lang}&page=1&include_adult=false`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).slice(0, 20);
  } catch { return []; }
}

export async function GET(request: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const category = searchParams.get('category') || '全部';
    const source = searchParams.get('source') || '全部';
    const region = searchParams.get('region') || '全部';
    const year = searchParams.get('year') || '全部';
    const sort = searchParams.get('sort') || 'release_date'; // release_date | added_time
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(150, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));
    const zone = searchParams.get('zone') || 'film';

    const conditions: string[] = [`r.status = 'active'`];
    const params: any[] = [];
    let idx = 1;

    if (category === '全部' && zone === 'film') {
      for (const cat of NONFILM_CATS) {
        conditions.push(`category != $${idx++}`);
        params.push(cat);
      }
    }
    if (category === '全部' && zone === 'nonfilm') {
      conditions.push(`category = ANY($${idx++})`);
      params.push(NONFILM_CATS);
    }
    if (category !== '全部') {
      conditions.push(`category = $${idx++}`);
      params.push(category);
    }
    if (source !== '全部') {
      const dbSource = SOURCE_KEY_MAP[source] || source;
      conditions.push(`source = $${idx++}`);
      params.push(dbSource);
    }
    // 年份筛选：优先用 tmdb_cache 的 release_date
    if (year !== '全部' && zone === 'film') {
      if (year === '2026' || year === '2025' || year === '2024' || year === '2023' || year === '2022' || year === '2021' || year === '2020') {
        conditions.push(`(c.release_date LIKE $${idx} OR c.release_date LIKE $${idx} || '%')`);
        params.push(`${year}-%`);
        idx++;
      } else if (year === '2010-2019') {
        conditions.push(`(c.release_date >= '2010-01-01' AND c.release_date <= '2019-12-31')`);
      } else if (year === '2000-2009') {
        conditions.push(`(c.release_date >= '2000-01-01' AND c.release_date <= '2009-12-31')`);
      }
    }
    if (q.trim()) {
      conditions.push(`(name ILIKE $${idx} OR category ILIKE $${idx})`);
      params.push(`%${q.trim()}%`);
      idx++;
    }

    const whereClause = conditions.join(' AND ');

    // ─── 如果有搜索词 + 选了分类，按分类的 sub_type 分别查 TMDB ───────────────
    let tmdbResults: any[] = [];
    if (q.trim() && zone === 'film' && category !== '全部') {
      if (category === '原盘') {
        const subRows = await sql(
          `SELECT DISTINCT sub_type FROM xx_resources WHERE category = '原盘' AND name ILIKE $1 AND status = 'active' AND sub_type IS NOT NULL AND sub_type != ''`,
          [`%${q.trim()}%`]
        ) as any[];
        const subTypes = (subRows || []).map((r: any) => r.sub_type).filter(Boolean);

        if (subTypes.length > 0) {
          for (const st of subTypes) {
            const types = getTypesForCategory('原盘', st);
            if (!types) continue;
            for (const type of types) {
              await sleep(20);
              const results = await searchTMDBByType(q.trim(), type, 'zh-CN');
              tmdbResults.push(...results);
            }
          }
        } else {
          const results = await searchTMDBByType(q.trim(), 'movie', 'zh-CN');
          tmdbResults.push(...results);
        }
      } else {
        const types = getTypesForCategory(category, null);
        const cats = types || (category === '纪录片' ? ['tv', 'movie'] : ['movie']);
        for (const type of cats) {
          await sleep(20);
          const results = await searchTMDBByType(q.trim(), type, 'zh-CN');
          tmdbResults.push(...results);
        }
      }

      // 地区筛选：用 TMDB 结果的 origin_country 过滤
      if (region !== '全部' && REGION_CODES[region]) {
        const codes = REGION_CODES[region];
        tmdbResults = tmdbResults.filter((r: any) => {
          const countries = r.origin_country || r.production_countries?.map((c: any) => c.iso_3166_1) || [];
          return codes.some((code) => countries.includes(code));
        });
      }

      // 年份筛选（TMDB 结果层面）
      if (year !== '全部' && zone === 'film') {
        if (['2026','2025','2024','2023','2022','2021','2020'].includes(year)) {
          tmdbResults = tmdbResults.filter((r: any) => {
            const d = r.release_date || r.first_air_date || '';
            return d.startsWith(year);
          });
        } else if (year === '2010-2019') {
          tmdbResults = tmdbResults.filter((r: any) => {
            const d = r.release_date || r.first_air_date || '';
            const y = parseInt(d.slice(0, 4));
            return y >= 2010 && y <= 2019;
          });
        } else if (year === '2000-2009') {
          tmdbResults = tmdbResults.filter((r: any) => {
            const d = r.release_date || r.first_air_date || '';
            const y = parseInt(d.slice(0, 4));
            return y >= 2000 && y <= 2009;
          });
        }
      }

      // 去重
      const seen = new Set<number>();
      tmdbResults = tmdbResults.filter((r: any) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
    }

    // 找出 TMDB 结果中在数据库里有资源的 tmdb_id
    const tmdbIds = tmdbResults.map((r: any) => String(r.id));
    const dbMatchedIds: string[] = [];
    const dbMatchedRows: any[] = [];

    if (tmdbIds.length > 0) {
      const placeholders = tmdbIds.map((_: any, i: number) => `$${i + 1}`).join(',');
      const matchedRows = await sql(
        `SELECT DISTINCT r.tmdb_id, c.title, c.poster_path, c.vote_average, c.release_date, c.overview
         FROM xx_resources r
         LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
         WHERE r.tmdb_id IN (${placeholders}) AND r.status = 'active'`,
        [...tmdbIds]
      );
      const rows = (matchedRows || []) as any[];
      dbMatchedIds.push(...rows.map((r: any) => r.tmdb_id).filter(Boolean));
      dbMatchedRows.push(...rows);
    }

    // tmdbWithDb 是 TMDB 搜到且库里有关联资源的
    const tmdbWithDb = tmdbResults.filter((r: any) => dbMatchedIds.includes(String(r.id)));
    if (sort === 'added_time') {
      // 上架时间：按 created_at 排序，TMDB 结果里没有 created_at，统一按 release_date
      tmdbWithDb.sort((a: any, b: any) => {
        const aDate = a.release_date || a.first_air_date || '';
        const bDate = b.release_date || b.first_air_date || '';
        return bDate.localeCompare(aDate);
      });
    } else {
      // 默认上映时间
      tmdbWithDb.sort((a: any, b: any) => {
        const aDate = a.release_date || a.first_air_date || '';
        const bDate = b.release_date || b.first_air_date || '';
        return bDate.localeCompare(aDate);
      });
    }

    // 无 DB 资源的 TMDB 结果排在后面
    const tmdbWithoutDb = tmdbResults.filter((r: any) => !dbMatchedIds.includes(String(r.id)));

    // ─── 查数据库资源 ───────────────────────────────────────────────────────
    const offset = (page - 1) * pageSize;
    const mergedIds = [...dbMatchedIds, ...tmdbWithoutDb.map((r: any) => String(r.id))];

    let dbConditions = [...conditions];
    if (mergedIds.length > 0) {
      dbConditions.push(`(r.tmdb_id IS NULL OR r.tmdb_id = '' OR NOT (r.tmdb_id = ANY($${idx++})))`);
      params.push(mergedIds);
    }

    const dbWhere = dbConditions.join(' AND ');
    const countRows = await sql(`SELECT COUNT(*) as count FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE ${dbWhere}`, params);
    const dbTotal = parseInt(countRows?.[0]?.count || '0');

    // 动态 ORDER BY
    let orderBy: string;
    if (sort === 'added_time') {
      // 上架时间：优先 has_tmdb，然后 created_at 降序，没 TMDB 的排后面
      orderBy = 'has_tmdb DESC, r.created_at DESC, sort_date DESC NULLS LAST';
    } else {
      // 默认上映时间：优先 has_tmdb，然后 release_date 降序
      orderBy = 'has_tmdb DESC, sort_date DESC NULLS LAST, r.created_at DESC';
    }

    const dbParams = [...params, pageSize, offset];
    const sqlStr = `SELECT r.id, r.name, r.link, r.link_code, r.source, r.category, r.size, r.type, r.tags, r.tmdb_id, r.view_count, r.created_at,
              COALESCE(c.release_date, r.created_at::text) as sort_date,
               CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb
       FROM xx_resources r
       LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
       WHERE ${dbWhere}
        ORDER BY ${orderBy}
        LIMIT $${idx} OFFSET $${idx + 1}`;
    console.log('DEBUG search:', { q, category, zone, page, pageSize, offset, idx, dbParamsLen: dbParams.length, sqlWhere: dbWhere, tmdbIdsLen: tmdbIds.length, mergedIdsLen: mergedIds.length });
    const dbRows = await sql(sqlStr, dbParams) as any[];
    console.log('DEBUG dbRows count:', dbRows.length, '| allItems len:', (dbRows?.length || 0) + (dbMatchedRows?.length || 0) + tmdbWithoutDb.length);

    const dbItems = (dbRows || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      link: item.link,
      linkCode: item.link_code,
      source: SOURCE_DISPLAY_MAP[item.source] || item.source,
      sourceKey: item.source,
      category: item.category,
      size: item.size,
      type: item.type,
      tags: item.tags || [],
      tmdbId: item.tmdb_id,
      viewCount: item.view_count,
      tmdb: null,
      musicCover: null,
      coverCache: null,
    }));

    // 把 TMDB 结果中有库资源的转成 items，拼到库里匹配结果后面
    const tmdbDbItems = dbMatchedRows.map((r: any) => ({
      id: null,
      name: r.title || '',
      link: '',
      linkCode: '',
      source: '',
      sourceKey: '',
      category: category,
      size: '',
      type: '',
      tags: [],
      tmdbId: String(r.tmdb_id || r.id),
      viewCount: 0,
      tmdb: {
        title: r.title || '',
        poster_path: r.poster_path || '',
        vote_average: r.vote_average || 0,
        release_date: r.release_date || '',
        overview: r.overview || '',
      },
      musicCover: null,
      coverCache: null,
    }));

    const allItems = [...dbItems, ...tmdbDbItems];
    const total = dbTotal + tmdbResults.length;

    const pageStart = (page - 1) * pageSize;
    const pageEnd = pageStart + pageSize;
    const pagedItems = allItems.slice(pageStart, pageEnd);

    // 批量获取 TMDB 信息
    const allTmdbIds: string[] = [];
    const seen2 = new Set<string>();
    pagedItems.forEach((item: any) => {
      if (item.tmdbId && !seen2.has(item.tmdbId)) { seen2.add(item.tmdbId); allTmdbIds.push(item.tmdbId); }
    });

    let tmdbMap = new Map<string, any>();
    if (allTmdbIds.length > 0) {
      const placeholders = allTmdbIds.map((_: any, i: number) => `$${i + 1}`).join(',');
      const tmdbRows = await sql(`SELECT * FROM xx_tmdb_cache WHERE tmdb_id IN (${placeholders})`, allTmdbIds);
      tmdbMap = new Map((tmdbRows || []).map((info: any) => [info?.tmdb_id, info]));
    }

    // 批量获取音乐封面
    const allIds = pagedItems.map((item: any) => item.id).filter(Boolean);
    let musicCoverMap = new Map<number, any>();
    let coverCacheMap = new Map<number, any>();
    if (allIds.length > 0) {
      const placeholders = allIds.map((_: any, i: number) => `$${i + 1}`).join(',');
      try {
        const musicRows = await sql(`SELECT resource_id, artist, album, cover_url FROM xx_music_cache WHERE resource_id IN (${placeholders})`, allIds);
        musicCoverMap = new Map((musicRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { musicCoverMap = new Map(); }
      try {
        const coverRows = await sql(`SELECT resource_id, cover_url, source, extra_data FROM xx_cover_cache WHERE resource_id IN (${placeholders})`, allIds);
        coverCacheMap = new Map((coverRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { coverCacheMap = new Map(); }
    }

    const resultItems = pagedItems.map((item: any) => ({
      ...item,
      tmdb: item.tmdbId ? tmdbMap.get(item.tmdbId) : null,
      musicCover: item.category === '音乐' ? musicCoverMap.get(item.id) || null : null,
      coverCache: !item.tmdbId ? coverCacheMap.get(item.id) || null : null,
    }));

    return NextResponse.json({
      total,
      page,
      pageSize,
      items: resultItems,
      categories: zone === 'film' ? CATEGORIES : NONFILM_CATEGORIES,
      sources: ['全部', ...Object.values(SOURCE_DISPLAY_MAP)],
    });
  } catch (error: any) {
    console.error('Search error:', error.message);
    return NextResponse.json({ error: '搜索失败: ' + error.message }, { status: 500 });
  }
}
