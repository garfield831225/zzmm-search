export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

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

// 地区 → 国家代码映射（与 TMDB iso_3166_1 一致）
const REGION_CODES: Record<string, string[]> = {
  '大陆': ['CN'],
  '欧美': ['US', 'GB', 'FR', 'DE', 'IT', 'ES', 'CA', 'AU', 'NZ'],
  '日韩': ['JP', 'KR'],
  '港澳台': ['HK', 'TW', 'MO'],
};

function esc(s: string) { return s.replace(/'/g, "''"); }

export async function GET(request: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const category = searchParams.get('category') || '全部';
    const source = searchParams.get('source') || '全部';
    const region = searchParams.get('region') || '全部';
    const year = searchParams.get('year') || '全部';
    const sort = searchParams.get('sort') || 'release_date';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(150, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));
    const zone = searchParams.get('zone') || 'film';

    // ─── WHERE clauses (inline strings — no param placeholders) ─────────────
    const catFilter = category === '全部' && zone === 'film'
      ? NONFILM_CATS.map(c => `r.category != '${esc(c)}'`).join(' AND ')
      : category === '全部' && zone === 'nonfilm'
      ? `r.category IN ('${NONFILM_CATS.map(esc).join("','")}')`
      : category !== '全部' ? `r.category = '${esc(category)}'` : '1=1';

    const sourceFilter = source !== '全部'
      ? `r.source = '${esc(SOURCE_KEY_MAP[source] || source)}'` : '1=1';

    const yearFilter = year !== '全部' && zone === 'film'
      ? (['2026','2025','2024','2023','2022','2021','2020'].includes(year)
        ? `(c.release_date LIKE '${year}-%')`
        : year === '2010-2019' ? "(c.release_date >= '2010-01-01' AND c.release_date <= '2019-12-31')"
        : year === '2000-2009' ? "(c.release_date >= '2000-01-01' AND c.release_date <= '2009-12-31')"
        : '1=1')
      : '1=1';

    const nameFilter = q.trim()
      ? `(r.name ILIKE '%${esc(q.trim())}%' OR r.category ILIKE '%${esc(q.trim())}%')`
      : '1=1';

    // 地区筛选：依赖 xx_tmdb_cache.origin_country（match 脚本写入）
    // 没 cache 的资源允许通过，等下次匹配
    const regionCodes = REGION_CODES[region];
    const regionFilter = regionCodes
      ? `(c.origin_country IS NOT NULL AND c.origin_country <> '' AND (${regionCodes.map(c => `c.origin_country LIKE '%${c}%'`).join(' OR ')}))`
      : '1=1';

    const whereClause = `r.status = 'active' AND ${catFilter} AND ${sourceFilter} AND ${regionFilter} AND ${yearFilter} AND ${nameFilter}`;

    // 排序逻辑：
    //   1) has_tmdb DESC（有 TMDB 排前面）
    //   2) "已播完"优先（release_date < 今天）— 未来日期沉到底
    //   3) 上映时间降序 / 上架时间降序
    //   4) r.created_at DESC（兜底）
    const dateWeight = `(CASE
      WHEN c.release_date IS NULL OR c.release_date = '' THEN 1
      WHEN c.release_date < CURRENT_DATE::text THEN 0
      ELSE 1
    END)`;
    const orderClause = sort === 'added_time'
      ? `has_tmdb DESC, ${dateWeight}, r.created_at DESC`
      : `has_tmdb DESC, ${dateWeight}, sort_date DESC NULLS LAST, r.created_at DESC`;
    const offset = (page - 1) * pageSize;

    // ─── Count ────────────────────────────────────────────────────────────────
    const countRows = await sql(`SELECT COUNT(*) as cnt FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE ${whereClause}`) as any[];
    const total = parseInt(countRows?.[0]?.cnt || '0');

    // ─── Fetch page ─────────────────────────────────────────────────────────
    const dbRows = await sql(`
      SELECT r.id, r.name, r.link, r.link_code, r.source, r.category, r.size, r.type, r.tags, r.tmdb_id, r.view_count, r.created_at,
             COALESCE(c.release_date, r.created_at::text) as sort_date,
             ${dateWeight} as date_weight,
             CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb
      FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ${pageSize} OFFSET ${offset}
    `) as any[];

    // ─── Batch TMDB cache ────────────────────────────────────────────────────
    const allIds = dbRows.map(r => r.id).filter(Boolean);
    const allTmdbIds: string[] = [];
    const seen = new Set<string>();
    dbRows.forEach(r => {
      if (r.tmdb_id && !seen.has(r.tmdb_id)) { seen.add(r.tmdb_id); allTmdbIds.push(r.tmdb_id); }
    });

    let tmdbMap = new Map<string, any>();
    if (allTmdbIds.length > 0) {
      const ids = await sql(`SELECT * FROM xx_tmdb_cache WHERE tmdb_id IN (${allTmdbIds.map(id => `'${esc(id)}'`).join(',')})`);
      tmdbMap = new Map((ids || []).map((info: any) => [info?.tmdb_id, info]));
    }

    // ─── Batch music/cover ─────────────────────────────────────────────────
    let musicCoverMap = new Map<number, any>();
    let coverCacheMap = new Map<number, any>();
    if (allIds.length > 0) {
      const idsStr = allIds.map(id => `${id}`).join(',');
      try {
        const musicRows = await sql(`SELECT resource_id, artist, album, cover_url FROM xx_music_cache WHERE resource_id IN (${idsStr})`);
        musicCoverMap = new Map((musicRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { musicCoverMap = new Map(); }
      try {
        const coverRows = await sql(`SELECT resource_id, cover_url, source, extra_data FROM xx_cover_cache WHERE resource_id IN (${idsStr})`);
        coverCacheMap = new Map((coverRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { coverCacheMap = new Map(); }
    }

    // ─── Map results ────────────────────────────────────────────────────────
    const items = dbRows.map((item: any) => ({
      id: item.id,
      name: item.name,
      link: item.link || '',
      linkCode: item.link_code || '',
      source: SOURCE_DISPLAY_MAP[item.source] || item.source || '',
      sourceKey: item.source || '',
      category: item.category || '',
      size: item.size || '',
      type: item.type || '',
      tags: item.tags ? (Array.isArray(item.tags) ? item.tags : []) : [],
      tmdbId: item.tmdb_id || null,
      viewCount: item.view_count || 0,
      tmdb: item.tmdb_id ? (tmdbMap.get(item.tmdb_id) || null) : null,
      musicCover: item.category === '音乐' ? (musicCoverMap.get(item.id) || null) : null,
      coverCache: !item.tmdb_id ? (coverCacheMap.get(item.id) || null) : null,
    }));

    return NextResponse.json({
      total,
      page,
      pageSize,
      items,
      categories: zone === 'film' ? CATEGORIES : NONFILM_CATEGORIES,
      sources: ['全部', ...Object.values(SOURCE_DISPLAY_MAP)],
    });
  } catch (error: any) {
    console.error('Search error:', error.message);
    return NextResponse.json({ error: '搜索失败: ' + error.message }, { status: 500 });
  }
}
