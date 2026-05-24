export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resources, tmdbCache } from '@/lib/db/schema';
import { eq, like, or, and, inArray, sql } from 'drizzle-orm';
import RedisCache from '@/lib/redis';
import { TMDB_KEY } from '@/lib/tmdb';

// 来源映射
const SOURCE_MAP: Record<string, string> = {
  '115': '115网盘',
  'baidu': '百度网盘',
  'quark': '夸克网盘',
  'aliyun': '阿里云盘',
  '123': '123网盘',
  'tianyi': '天翼云盘',
  'magnet': '磁力链接',
  'ed2k': 'ed2k链接',
  'thunder': '迅雷链接',
};

// 分类列表
const CATEGORIES = ['全部', '电影', '剧集', '动漫', '综艺', '音乐', '纪录片', '学习资料', '其他'];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const category = searchParams.get('category') || '全部';
    const source = searchParams.get('source') || '全部';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '30');

    // 构建缓存key
    const cacheKey = `${q}:${category}:${source}:${page}`;
    const cached = await RedisCache.getSearch(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // 构建查询条件
    const conditions = [eq(resources.status, 'active')];

    if (category !== '全部') {
      conditions.push(eq(resources.category, category));
    }

    if (source !== '全部') {
      conditions.push(eq(resources.source, source));
    }

    if (q) {
      conditions.push(
        or(
          like(resources.name, `%${q}%`),
          like(resources.category, `%${q}%`)
        )
      );
    }

    // 查询总数
    const countResult = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*) as count FROM xx_resources WHERE status = 'active' ${
        category !== '全部' ? sql` AND category = ${category}` : sql``
      } ${source !== '全部' ? sql` AND source = ${source}` : sql``} ${
        q ? sql` AND (name ILIKE ${'%' + q + '%'} OR category ILIKE ${'%' + q + '%'})` : sql``
      }`
    );
    const total = countResult[0]?.count || 0;

    // 分页查询
    const offset = (page - 1) * pageSize;
    const items = await db.execute(
      sql`SELECT id, name, link, link_code, source, category, size, type, tags, tmdb_id, view_count
          FROM xx_resources
          WHERE status = 'active'
          ${category !== '全部' ? sql` AND category = ${category}` : sql``}
          ${source !== '全部' ? sql` AND source = ${source}` : sql``}
          ${q ? sql` AND (name ILIKE ${'%' + q + '%'} OR category ILIKE ${'%' + q + '%'})` : sql``}
          ORDER BY view_count DESC, created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}`
    );

    // 批量获取TMDB信息
    const tmdbIds = items
      .map((item: any) => item.tmdb_id)
      .filter(Boolean)
      .filter((id: string, index: number, arr: string[]) => arr.indexOf(id) === index);

    const tmdbInfos = await db.execute(
      sql`SELECT * FROM xx_tmdb_cache WHERE tmdb_id IN (${tmdbIds.map((id: string) => `'${id}'`).join(',')})`
    );

    const tmdbMap = new Map(tmdbInfos.map((info: any) => [info.tmdb_id, info]));

    // 组装返回数据
    const result = {
      total,
      page,
      pageSize,
      items: items.map((item: any) => ({
        id: item.id,
        name: item.name,
        link: item.link,
        linkCode: item.link_code,
        source: SOURCE_MAP[item.source] || item.source,
        sourceKey: item.source,
        category: item.category,
        size: item.size,
        type: item.type,
        tags: item.tags || [],
        tmdbId: item.tmdb_id,
        viewCount: item.view_count,
        tmdb: item.tmdb_id ? tmdbMap.get(item.tmdb_id) : null,
      })),
      categories: CATEGORIES,
      sources: ['全部', ...Object.keys(SOURCE_MAP).map(k => SOURCE_MAP[k])],
    };

    // 缓存结果
    await RedisCache.setSearch(cacheKey, result);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}