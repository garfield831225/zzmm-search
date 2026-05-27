export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const SOURCE_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};
const CATEGORIES = ['全部', '电影', '剧集', '动漫', '综艺', '音乐', '纪录片', '学习资料', '其他'];

export async function GET(request: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const category = searchParams.get('category') || '全部';
    const source = searchParams.get('source') || '全部';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));

    // 构建参数化查询条件
    const conditions: string[] = [`status = 'active'`];
    const params: any[] = [];
    let idx = 1;

    if (category !== '全部') {
      conditions.push(`category = $${idx++}`);
      params.push(category);
    }
    if (source !== '全部') {
      conditions.push(`source = $${idx++}`);
      params.push(source);
    }
    if (q.trim()) {
      conditions.push(`(name ILIKE $${idx} OR category ILIKE $${idx})`);
      params.push(`%${q.trim()}%`);
      idx++;
    }

    const whereClause = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    // 查询总数
    const countRows = await sql(`SELECT COUNT(*) as count FROM xx_resources WHERE ${whereClause}`, params);
    const total = parseInt(countRows?.[0]?.count || '0');

    // 分页查询
    const queryParams = [...params, pageSize, offset];
    const rows = await sql(
      `SELECT id, name, link, link_code, source, category, size, type, tags, tmdb_id, view_count
       FROM xx_resources
       WHERE ${whereClause}
       ORDER BY view_count DESC, created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
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

    return NextResponse.json({
      total,
      page,
      pageSize,
      items: itemsArr.map((item: any) => ({
        id: item?.id,
        name: item?.name,
        link: item?.link,
        linkCode: item?.link_code,
        source: SOURCE_MAP[item?.source] || item?.source,
        sourceKey: item?.source,
        category: item?.category,
        size: item?.size,
        type: item?.type,
        tags: item?.tags || [],
        tmdbId: item?.tmdb_id,
        viewCount: item?.view_count,
        tmdb: item?.tmdb_id ? tmdbMap.get(item.tmdb_id) : null,
      })),
      categories: CATEGORIES,
      sources: ['全部', ...Object.values(SOURCE_MAP)],
    });
  } catch (error: any) {
    console.error('Search error:', error.message);
    return NextResponse.json({ error: '搜索失败: ' + error.message }, { status: 500 });
  }
}