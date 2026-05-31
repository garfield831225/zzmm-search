export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// source display name → db value 映射（前端传"115网盘" → 查"115"）
const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '夸克网盘': 'quark', '123网盘': '123', '天翼云盘': 'tianyi',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k', '迅雷链接': 'thunder',
};
// db value → display name 映射
const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};
const CATEGORIES = ['全部', '连载', '电影', '剧集', '动漫', '少儿频道', '综艺', '演唱会', '纪录片', '原盘', 'REMUX', '系列电影'];
const NONFILM_CATEGORIES = ['全部', '音乐', '体育', '游戏', '电子书', '精品课', '文档'];
// 影视区"全部"排除的分类（非影视区专用）
const NONFILM_CATS = ['音乐', '体育', '游戏', '电子书', '精品课', '文档'];

export async function GET(request: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const category = searchParams.get('category') || '全部';
    const source = searchParams.get('source') || '全部';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));
    const zone = searchParams.get('zone') || 'film'; // 'film' | 'nonfilm'

    // 构建参数化查询条件
    const conditions: string[] = [`status = 'active'`];
    const params: any[] = [];
    let idx = 1;

    // 影视区"全部"：排除非影视分类
    if (category === '全部' && zone === 'film') {
      for (const cat of NONFILM_CATS) {
        conditions.push(`category != $${idx++}`);
        params.push(cat);
      }
    }
    // 非影视区"全部"：只包含非影视分类
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
    if (q.trim()) {
      conditions.push(`(name ILIKE $${idx} OR category ILIKE $${idx})`);
      params.push(`%${q.trim()}%`);
      idx++;
    }

    // 排序：有TMDB匹配→按release_date降序；无匹配→按created_at降序
    const whereClause = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    // 查询总数
    const countRows = await sql(`SELECT COUNT(*) as count FROM xx_resources WHERE ${whereClause}`, params);
    const total = parseInt(countRows?.[0]?.count || '0');

    // 分页查询（按 TMDB 上映时间降序，有匹配优先）
    const limitIdx = idx;
    const offsetIdx = idx + 1;
    const queryParams = [...params, pageSize, offset];
    const rows = await sql(
      `SELECT r.id, r.name, r.link, r.link_code, r.source, r.category, r.size, r.type, r.tags, r.tmdb_id, r.view_count, r.created_at,
              COALESCE(c.release_date, r.created_at::text) as sort_date,
              CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 0 ELSE 1 END as has_tmdb
       FROM xx_resources r
       LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
       WHERE ${whereClause}
       ORDER BY has_tmdb ASC, sort_date DESC NULLS LAST, r.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams
    );

    const itemsArr = rows || [];

    // 批量获取TMDB信息
    const tmdbIds = itemsArr
      .map((item: any) => item?.tmdb_id)
      .filter((id: any): id is string => Boolean(id))
      .filter((id: string, i: number, arr: string[]) => arr.indexOf(id) === i);

    let tmdbMap = new Map<string, any>();
    if (tmdbIds.length > 0) {
      const placeholders = tmdbIds.map((_: any, i: number) => `$${i + 1}`).join(',');
      const tmdbRows = await sql(`SELECT * FROM xx_tmdb_cache WHERE tmdb_id IN (${placeholders})`, tmdbIds);
      tmdbMap = new Map((tmdbRows || []).map((info: any) => [info?.tmdb_id, info]));
    }

    // 批量获取音乐封面信息
    const resourceIds = itemsArr.map((item: any) => item?.id).filter(Boolean);
    let musicCoverMap = new Map<number, any>();
    if (resourceIds.length > 0) {
      try {
        const placeholders = resourceIds.map((_: any, i: number) => `$${i + 1}`).join(',');
        const musicRows = await sql(`SELECT resource_id, artist, album, cover_url FROM xx_music_cache WHERE resource_id IN (${placeholders})`, resourceIds);
        musicCoverMap = new Map((musicRows || []).map((r: any) => [r?.resource_id, r]));
      } catch {
        musicCoverMap = new Map(); // 表不存在就忽略
      }
    }

    // 批量获取通用封面（非影视，无 TMDB 时显示）
    let coverCacheMap = new Map<number, any>();
    if (resourceIds.length > 0) {
      try {
        const placeholders = resourceIds.map((_: any, i: number) => `$${i + 1}`).join(',');
        const coverRows = await sql(`SELECT resource_id, cover_url, source, extra_data FROM xx_cover_cache WHERE resource_id IN (${placeholders})`, resourceIds);
        coverCacheMap = new Map((coverRows || []).map((r: any) => [r?.resource_id, r]));
      } catch {
        coverCacheMap = new Map(); // 表不存在就忽略，不影响搜索
      }
    }

    return NextResponse.json({
      total,
      page,
      pageSize,
      items: itemsArr.map((item: any) => ({
        id: item?.id,
        name: item?.name,
        link: item?.link,
        linkCode: item?.link_code,
        source: SOURCE_DISPLAY_MAP[item?.source] || item?.source,
        sourceKey: item?.source,
        category: item?.category,
        size: item?.size,
        type: item?.type,
        tags: item?.tags || [],
        tmdbId: item?.tmdb_id,
        viewCount: item?.view_count,
        tmdb: item?.tmdb_id ? tmdbMap.get(item.tmdb_id) : null,
        musicCover: item?.category === '音乐' ? musicCoverMap.get(item.id) || null : null,
        coverCache: !item?.tmdb_id && !musicCoverMap.get(item.id) ? coverCacheMap.get(item.id) || null : null,
      })),
      categories: zone === 'film' ? CATEGORIES : NONFILM_CATEGORIES,
      sources: ['全部', ...Object.values(SOURCE_DISPLAY_MAP)],
    });
  } catch (error: any) {
    console.error('Search error:', error.message);
    return NextResponse.json({ error: '搜索失败: ' + error.message }, { status: 500 });
  }
}