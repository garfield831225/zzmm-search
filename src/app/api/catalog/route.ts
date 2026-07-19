// 2026-07-18: /titles 独立目录页 API
// 业务规则: 纯目录浏览, 跟 /library 一样的内容 (但不返 link/url 实际值), 不要求登录
// 用户 2026-07-18: "你特么就理解为，不要操作列，其他一样"
// 泽泽妈妈115文档里: 分类列用 doc_sheet (21-sheet 库的 sheet 名)
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

const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};

export async function GET(request: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(request.url);

  const q = (searchParams.get('q') || '').trim();
  const category = searchParams.get('category') || '全部';
  const section = searchParams.get('section') || '';  // zezhe/vip/code (跟 /library 对齐)
  const sort = (searchParams.get('sort') || 'asc').toLowerCase();  // asc=按添加时间正序(默认) / desc=倒序
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(150, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));

  try {
    // 1. 分类过滤 (用 sheet 优先, 没有用 category)
    // 泽泽妈妈115文档 (section=zezhe) 的"分类"列实际是 doc_sheet
    // 因为 21-sheet 库里 "合集" sheet 的资源主表 category 字段全设 "合集", 但用户希望按 sheet 名分组
    const catFilter = (category === '全部' || !category)
      ? '1=1'
      : `(r.category = '${category.replace(/'/g, "''")}' OR r.doc_sheet = '${category.replace(/'/g, "''")}')`;

    // 2. 标题搜索
    const nameFilter = q
      ? `(r.name ILIKE '%${q.replace(/'/g, "''")}%')`
      : '1=1';

    // 3. Section 过滤 (跟 /library 一致: 3 大区)
    // zezhe = import_channel = 'zezemom_excel'
    // vip = access_level = 'vip' (排除 zezhe, 因为 zezhe 资源 access_level='basic')
    // code = access_level = 'code'
    let sectionFilter = '1=1';
    if (section === 'zezhe') sectionFilter = "(r.import_channel = 'zezemom_excel')";
    else if (section === 'vip') sectionFilter = "(r.access_level = 'vip')";
    else if (section === 'code') sectionFilter = "(r.access_level = 'code')";

    // 4. Count
    const countRows = await sql(`
      SELECT COUNT(*)::int as cnt
      FROM xx_resources r
      WHERE r.status = 'active' AND ${sectionFilter} AND ${catFilter} AND ${nameFilter}
    `) as any[];
    const total = countRows?.[0]?.cnt || 0;

    // 5. 列表 — 跟 /library 一样返所有字段 (但去掉 link/url/linkCode 实际值)
    const offset = (page - 1) * pageSize;
    // 2026-07-20: 按文档内添加时间排序 (asc=正序/从老到新, desc=倒序)
    const orderDir = sort === 'desc' ? 'DESC' : 'ASC';
    const dbRows = await sql(`
      SELECT r.id, r.name, r.category, r.tags, r.tmdb_id,
             r.doc_sheet, r.sub_type, r.size, r.type, r.created_at, r.access_level, r.import_channel, r.source,
             COALESCE(c.title, r.name) as display_title,
             c.poster_path, c.vote_average, c.vote_count, c.release_date, c.status as tmdb_status
      FROM xx_resources r
      LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
      WHERE r.status = 'active' AND ${sectionFilter} AND ${catFilter} AND ${nameFilter}
      ORDER BY r.created_at ${orderDir}, r.id ${orderDir}
      LIMIT ${pageSize} OFFSET ${offset}
    `) as any[];

    // 6. Item 结构 (跟 /library 一样, 但去掉 link/url)
    const items = dbRows.map(row => ({
      id: row.id,
      name: row.display_title || row.name,
      // 分类列逻辑: 泽泽妈妈115文档 用 doc_sheet (21-sheet 库的 sheet 名), 其他用 category
      // 前端展示优先: docSheet 优先, category 兜底
      displayCategory: row.doc_sheet || row.category,
      category: row.category,
      docSheet: row.doc_sheet,
      subType: row.sub_type,
      size: row.size,
      type: row.type,
      tags: row.tags || [],
      tmdbIdRaw: row.tmdb_id,
      source: row.source,
      sourceDisplay: SOURCE_DISPLAY_MAP[row.source] || row.source || '—',
      createdAt: row.created_at,
      importChannel: row.import_channel,
      accessLevel: row.access_level,
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
