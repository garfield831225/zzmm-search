export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import RedisCache from '@/lib/redis';

const SOURCE_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};
const CATEGORIES = ['全部', '电影', '剧集', '动漫', '综艺', '音乐', '纪录片', '学习资料', '其他'];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const category = searchParams.get('category') || '全部';
    const source = searchParams.get('source') || '全部';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '30');

    const cacheKey = `${q}:${category}:${source}:${page}`;
    const cached = await RedisCache.getSearch(cacheKey);
    if (cached) return NextResponse.json(cached);

    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL!);

    // 动态WHERE拼接，参数化防注入
    let whereClause = "status = 'active'";
    const params: any[] = [];
    let paramIdx = 1;

    if (category !== '全部') {
      whereClause += ` AND category = $${paramIdx++}`;
      params.push(category);
    }
    if (source !== '全部') {
      const sourceKey = Object.keys(SOURCE_MAP).find(k => SOURCE_MAP[k] === source);
      if (sourceKey) {
        whereClause += ` AND source = $${paramIdx++}`;
        params.push(sourceKey);
      }
    }
    if (q) {
      whereClause += ` AND (name ILIKE $${paramIdx++} OR category ILIKE $${paramIdx++})`;
      params.push(`%${q}%`);
      params.push(`%${q}%`);
    }

    const offset = (page - 1) * pageSize;
    const sqlAny = sql as any;

    const countSql = `SELECT COUNT(*) as count FROM xx_resources WHERE ${whereClause}`;
    const countResult = await sqlAny.query(countSql, params) as any[];
    const total = Number(countResult?.[0]?.count || 0);

    const itemsSql = `SELECT id, name, link, link_code, source, category, size, type, tags, tmdb_id, view_count
      FROM xx_resources WHERE ${whereClause}
      ORDER BY view_count DESC, created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    const items = await sqlAny.query(itemsSql, [...params, pageSize, offset]) as any[];

    // TMDB信息
    const tmdbIds = Array.from(new Set(items.map((i: any) => i.tmdb_id).filter(Boolean))) as string[];
    const tmdbMap = new Map();
    if (tmdbIds.length > 0) {
      const tmdbInfos = await sql`SELECT * FROM xx_tmdb_cache WHERE tmdb_id = ANY(${tmdbIds})` as any[];
      tmdbInfos.forEach((info: any) => tmdbMap.set(info.tmdb_id, info));
    }

    const result = {
      total, page, pageSize,
      items: items.map((item: any) => ({
        id: item.id, name: item.name, link: item.link, linkCode: item.link_code,
        source: SOURCE_MAP[item.source] || item.source, sourceKey: item.source,
        category: item.category, size: item.size, type: item.type,
        tags: item.tags || [], tmdbId: item.tmdb_id, viewCount: item.view_count,
        tmdb: item.tmdb_id ? tmdbMap.get(item.tmdb_id) : null,
      })),
      categories: CATEGORIES,
      sources: ['全部', ...Object.keys(SOURCE_MAP).map(k => SOURCE_MAP[k])],
    };

    await RedisCache.setSearch(cacheKey, result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
