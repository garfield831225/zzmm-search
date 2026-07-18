// 2026-07-18: /titles 独立目录页 API
// 业务规则: 纯目录浏览, 不返任何网盘/磁力链接, 不要求登录
// 跟 /library 一样的内容, 但去掉 link/url/source 字段, 所有人都能看
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CATEGORIES = [
  '电影', '剧集', '动漫', '纪录片', '综艺', '演唱会',
  '音乐', '体育', '少儿频道', '连载',
  '原盘', 'REMUX', '系列电影', '合集',
  '电子书', '精品课', '文档',
];

export async function GET(request: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(request.url);

  const q = (searchParams.get('q') || '').trim();
  const category = searchParams.get('category') || '全部';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(150, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));

  try {
    // 1. 分类过滤
    const catFilter = (category === '全部' || !category)
      ? '1=1'
      : `r.category = '${category.replace(/'/g, "''")}'`;

    // 2. 标题搜索
    const nameFilter = q
      ? `(r.name ILIKE '%${q.replace(/'/g, "''")}%' OR r.category ILIKE '%${q.replace(/'/g, "''")}%')`
      : '1=1';

    // 3. Count
    const countRows = await sql(`
      SELECT COUNT(*)::int as cnt
      FROM xx_resources r
      WHERE r.status = 'active' AND ${catFilter} AND ${nameFilter}
    `) as any[];
    const total = countRows?.[0]?.cnt || 0;

    // 4. 列表 — 不返 link/url/source/link_code (纯目录)
    const offset = (page - 1) * pageSize;
    const dbRows = await sql(`
      SELECT r.id, r.name, r.category, r.tags, r.tmdb_id,
             r.doc_sheet, r.sub_type, r.created_at, r.access_level, r.import_channel,
             COALESCE(c.title, r.name) as display_title,
             c.poster_path, c.vote_average, c.vote_count, c.release_date, c.status as tmdb_status
      FROM xx_resources r
      LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
      WHERE r.status = 'active' AND ${catFilter} AND ${nameFilter}
      ORDER BY r.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `) as any[];

    // 5. 加封面 URL (TMDB)
    const items = dbRows.map(row => ({
      id: row.id,
      name: row.display_title || row.name,
      category: row.category,
      tags: row.tags || [],
      docSheet: row.doc_sheet,
      subType: row.sub_type,
      createdAt: row.created_at,
      importChannel: row.import_channel,
      // TMDB 封面
      poster: row.poster_path
        ? `https://image.tmdb.org/t/p/w300${row.poster_path}`
        : null,
      voteAverage: row.vote_average,
      releaseDate: row.release_date,
      tmdbStatus: row.tmdb_status,
    }));

    return NextResponse.json({
      total,
      page,
      pageSize,
      items,
      categories: CATEGORIES,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
