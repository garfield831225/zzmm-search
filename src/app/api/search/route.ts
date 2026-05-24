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

    // neon tagged template不支持动态WHERE，分情况构建不同SQL
    const sourceKey = source !== '全部' ? Object.keys(SOURCE_MAP).find(k => SOURCE_MAP[k] === source) : null;

    let countResult: any[];
    let items: any[];

    if (!q && category === '全部' && !sourceKey) {
      // 无过滤条件
      countResult = await sql`SELECT COUNT(*) as count FROM xx_resources WHERE status = 'active'`;
      const total = Number(countResult[0]?.count || 0);
      const offset = (page - 1) * pageSize;
      items = await sql`SELECT id, name, link, link_code, source, category, size, type, tags, tmdb_id, view_count
        FROM xx_resources WHERE status = 'active'
        ORDER BY view_count DESC, created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`;
      return await buildResponse(sql, total, items, page, pageSize, cacheKey);
    }

    if (q && category !== '全部' && sourceKey) {
      // 全部条件
      countResult = await sql`SELECT COUNT(*) as count FROM xx_resources WHERE status = 'active' AND category = ${category} AND source = ${sourceKey} AND (name ILIKE ${'%' + q + '%'} OR category ILIKE ${'%' + q + '%'})`;
      const total = Number(countResult[0]?.count || 0);
      const offset = (page - 1) * pageSize;
      items = await sql`SELECT id, name, link, link_code, source, category, size, type, tags, tmdb_id, view_count
        FROM xx_resources WHERE status = 'active' AND category = ${category} AND source = ${sourceKey} AND (name ILIKE ${'%' + q + '%'} OR category ILIKE ${'%' + q + '%'})
        ORDER BY view_count DESC, created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`;
      return await buildResponse(sql, total, items, page, pageSize, cacheKey);
    }

    // 通用方案：查出所有active数据，JS侧过滤
    // 只在数据量小的时候使用（<10万条）
    const allItems = await sql`SELECT id, name, link, link_code, source, category, size, type, tags, tmdb_id, view_count
      FROM xx_resources WHERE status = 'active'
      ORDER BY view_count DESC, created_at DESC` as any[];

    let filtered = allItems;
    if (category !== '全部') filtered = filtered.filter(i => i.category === category);
    if (sourceKey) filtered = filtered.filter(i => i.source === sourceKey);
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(i => i.name?.toLowerCase().includes(ql) || i.category?.toLowerCase().includes(ql));
    }

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    items = filtered.slice(offset, offset + pageSize);
    return await buildResponse(sql, total, items, page, pageSize, cacheKey);

  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: '搜索失败', detail: String(error) }, { status: 500 });
  }
}

async function buildResponse(sql: any, total: number, items: any[], page: number, pageSize: number, cacheKey: string) {
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
}
