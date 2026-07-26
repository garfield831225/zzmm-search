// 2026-07-20: /titles 和 /library 统一目录 API
// 业务规则:
//   - /titles: 纯目录浏览, 不返 link/url 实际值, 不要求登录
//   - /library: 完整功能, 返 link/提取码/解锁状态等
//   - 两个页面共用此 API, 通过 zone=titles|library 区分字段返回
//   - 分类方案:
//       zezhe (泽泽妈妈115文档) → 按 doc_sheet 分类 (21-sheet 库的 sheet 名)
//       vip / code → 按 source (网盘类型) 分类
//       pending (2026-07-27) → 网盘 + category 其他/影视/动漫/电子书/软件
//   - 排序: 按 created_at asc=文档原始顺序 (默认) / desc=倒序
//
// 2026-07-27 重大修复 (用户报: library 看不到泽泽妈文档):
//   1) 改 nodejs runtime — Edge runtime 多次 await sql() 第二次 query (副表) 偶发返空
//      (Neon serverless 在 Edge session 下 session 不持久, 副表 xx_resource_links 返 []  →  library 看不到"打开"按钮)
//   2) 主表 LEFT JOIN xx_resource_links ON resource_id 单次 query 拿全部数据, 避免 2 次 await
//   3) 用 json_agg 聚合副链接数组, 比 Map 维护简单稳
//   4) 去掉 sync_marker 写表 (有 bug: 删 0 行不报错但增加 read replica lag)
//   5) 兼容 IN ('zezhe', 'zezemom_excel') 双命名
//   6) 加 catGroup 参数 (5 大类: 影视/动漫/电子书/软件/全部)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// 2026-07-27: 改 nodejs runtime — 修 Edge runtime 下副表查询返空 bug
// 性能影响: 函数启动比 edge 慢 ~200ms, 但稳
// maxDuration 30s 跟 edge 一样 (Vercel hobby 60s, 我们用 30s 防超时)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
  'xunlei': '迅雷', 'uc': 'UC网盘', 'yidong': '移动云盘',
};
const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '夸克网盘': 'quark', '123网盘': '123', '天翼云盘': 'tianyi',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k', '迅雷链接': 'thunder',
  '迅雷': 'xunlei', 'UC网盘': 'uc', '移动云盘': 'yidong',
};

export async function GET(request: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(request.url);

  const q = (searchParams.get('q') || '').trim();
  const section = searchParams.get('section') || '';  // '' (全部) | zezhe | vip | code | pending
  const sheet = searchParams.get('sheet') || '';        // zezhe 区分类
  const source = searchParams.get('source') || '';      // vip/code 区分类
  const sort = (searchParams.get('sort') || 'asc').toLowerCase();  // asc=正序 | desc=倒序
  const zone = searchParams.get('zone') || 'titles';    // 'titles' (无链接) | 'library' (完整)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(150, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
  // 2026-07-27: pending 区大类 (用户视角的 5 大类: 影视/动漫/电子书/软件/全部)
  // 影视 = 电影 + 剧集 + 综艺 + 纪录片
  const catGroup = searchParams.get('catGroup') || '';  // '' (全部) | 影视 | 动漫 | 电子书 | 软件

  try {
    // 1. Section 过滤 (跟 /library 业务规则一致: 4 大区 + 全部)
    let sectionFilter = '1=1';
    let sectionChannel = '';
    if (section === 'zezhe') {
      // 2026-07-27: 兼容 'zezhe' + 'zezemom_excel' 两种命名
      sectionFilter = "(r.import_channel IN ('zezhe', 'zezemom_excel'))";
      sectionChannel = 'zezhe';
    } else if (section === 'vip') {
      sectionFilter = "(r.access_level = 'vip')";
      sectionChannel = 'vip';
    } else if (section === 'code') {
      // pay_type='code' 优先, 兼容 access_level='code'
      sectionFilter = "(r.pay_type = 'code' OR r.access_level = 'code')";
      sectionChannel = 'code';
    } else if (section === 'pending') {
      // 2026-07-27 待归类: 网盘 + 重分类后 5 大类 (其他/电影/剧集/综艺/纪录片/动漫/电子书/软件)
      // 排除 zezhe/zezemom_excel (这些属于 zezhe section, 不算"待归类")
      sectionFilter = "(r.source IN ('baidu','quark','aliyun','115','uc','xunlei','123','tianyi','yidong','magnet','ed2k') AND r.category IN ('其他','电影','剧集','综艺','纪录片','动漫','电子书','软件') AND r.import_channel NOT IN ('zezhe', 'zezemom_excel'))";
      sectionChannel = 'pending';
    }

    // 2. WHERE 拼装 (用 addCond 模式避免 Neon 兼容层 template tag 问题)
    const conds: string[] = [];
    const condVals: any[] = [];
    const addCond = (condSQL: string, ...vals: any[]) => {
      const offset = condVals.length;
      const renum = condSQL.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + offset}`);
      conds.push(renum);
      condVals.push(...vals);
    };
    addCond('r.status = $1', 'active');
    if (section !== '') {
      conds.push(sectionFilter);
    }
    if (sheet) addCond('r.doc_sheet = $1', sheet);
    else if (source) addCond('r.source = $1', SOURCE_KEY_MAP[source] || source);
    // 2026-07-27: pending 区大类过滤 (5 大类)
    if (section === 'pending' && catGroup) {
      if (catGroup === '影视') addCond("r.category IN ('电影','剧集','综艺','纪录片')");
      else if (catGroup === '动漫') addCond("r.category = '动漫'");
      else if (catGroup === '电子书') addCond("r.category = '电子书'");
      else if (catGroup === '软件') addCond("r.category = '软件'");
    }
    if (q) addCond('(r.name ILIKE $1 OR r.category ILIKE $1)', `%${q}%`);
    const whereSQL = 'WHERE ' + conds.join(' AND ');

    // 3. Count (主表 count, 不需要 LEFT JOIN)
    const countSQL = `SELECT COUNT(*) as cnt FROM xx_resources r ${whereSQL}`;
    const countRows = await sql(countSQL, condVals) as any[];
    const total = parseInt(countRows?.[0]?.cnt || '0');

    // 4. 主表 + 副表 LEFT JOIN 单次 query
    // 2026-07-27 修: 用 json_agg + FILTER + ORDER BY 把副链接直接拼到主表行
    // 这样 1 次 await sql() 拿全部数据, 避免 Edge runtime 多次 await 副表返空 bug
    // 副链接: SELECT resource_id, source, url, password, sort, access_level, status FROM xx_resource_links WHERE status='active' AND source IS NOT NULL ORDER BY sort ASC, id ASC
    const orderDir = sort === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * pageSize;
    const limitPlaceholder = `$${condVals.length + 1}`;
    const offsetPlaceholder = `$${condVals.length + 2}`;

    const listSQL = `
      SELECT r.id, r.name, r.category, r.tags, r.tmdb_id,
             r.doc_sheet, r.sub_type, r.size, r.type, r.created_at, r.access_level, r.import_channel, r.source,
             r.link, r.link_code, r.is_multi_link,
             COALESCE(c.title, r.name) as display_title,
             c.poster_path, c.vote_average, c.vote_count, c.release_date, c.status as tmdb_status,
             COALESCE(
               (
                 SELECT json_agg(
                   json_build_object(
                     'source', l.source,
                     'url', l.url,
                     'password', l.password,
                     'sort', l.sort,
                     'accessLevel', l.access_level,
                     'status', l.status
                   ) ORDER BY l.sort ASC, l.id ASC
                 )
                 FROM xx_resource_links l
                 WHERE l.resource_id = r.id
                   AND l.status = 'active'
                   AND l.source IS NOT NULL
               ),
               '[]'::json
             ) as sub_links
      FROM xx_resources r
      LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
      ${whereSQL}
      ORDER BY r.created_at ${orderDir}, r.id ${orderDir}
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;
    const dbRows = await sql(listSQL, [...condVals, pageSize, offset]) as any[];

    // 5. Item 结构 (sub_links 已经是 json 数组, 直接 parse)
    const items = dbRows.map((row: any) => {
      const subLinks = Array.isArray(row.sub_links) ? row.sub_links : (typeof row.sub_links === 'string' ? JSON.parse(row.sub_links) : []);
      const base: any = {
        id: row.id,
        name: row.display_title || row.name,
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
        isMultiLink: row.is_multi_link || false,
        poster: row.poster_path
          ? `https://image.tmdb.org/t/p/w300${row.poster_path}`
          : null,
        voteAverage: row.vote_average,
        releaseDate: row.release_date,
        tmdbStatus: row.tmdb_status,
      };
      // 库模式 (zone=library) 才返 link + linkCode (titles 永不返)
      if (zone === 'library') {
        base.link = row.link || '';
        base.linkCode = row.link_code || '';
        base.lumenCost = row.lumen_cost || 1;
      }
      // 副链接: 有 subLinks 用 subLinks, 否则 fallback 主表 link
      // library 模式必须有链接 (titles 也带上 subLinks 用于判断 isMultiLink)
      if (subLinks && subLinks.length > 0) {
        base.links = subLinks;
      } else if (row.link) {
        base.links = [{
          source: row.source,
          url: row.link,
          password: row.link_code,
          sort: 1,
          accessLevel: row.access_level,
          status: 'active',
        }];
      } else {
        base.links = [];
      }
      return base;
    });

    // 6. 返分类按钮列表 (用于前端显示 sheet/source 按钮)
    let categories: { name: string; key: string; count: number }[] = [];
    if (section === 'zezhe') {
      // 21-sheet 库的 sheet 名 + count
      const sheetRows = await sql`
        SELECT doc_sheet, COUNT(*) as cnt
        FROM xx_resources
        WHERE status='active' AND import_channel IN ('zezhe', 'zezemom_excel') AND doc_sheet IS NOT NULL
        GROUP BY doc_sheet
        ORDER BY cnt DESC, doc_sheet ASC
      `;
      categories = (sheetRows || []).map((r: any) => ({ name: r.doc_sheet, key: r.doc_sheet, count: parseInt(r.cnt) }));
    } else if (section === 'vip' || section === 'code') {
      const accessLevel = section;  // 'vip' or 'code'
      const sourceRows = await sql`
        SELECT source, COUNT(*)::int as cnt
        FROM xx_resources
        WHERE status='active' AND access_level=${accessLevel} AND source IS NOT NULL
        GROUP BY source
        ORDER BY cnt DESC, source ASC
      `;
      categories = (sourceRows || []).map((r: any) => ({
        name: SOURCE_DISPLAY_MAP[r.source] || r.source,
        key: SOURCE_DISPLAY_MAP[r.source] || r.source,
        count: parseInt(r.cnt),
      }));
    } else if (section === 'pending') {
      // 2026-07-27 待归类: 网盘 + category='其他' 的 source 分布
      const sourceRows = await sql`
        SELECT source, COUNT(*)::int as cnt
        FROM xx_resources
        WHERE status='active' AND category='其他' AND source IN ('baidu','quark','aliyun','115','uc','xunlei','123','tianyi','yidong','magnet','ed2k')
        GROUP BY source
        ORDER BY cnt DESC, source ASC
      `;
      categories = (sourceRows || []).map((r: any) => ({
        name: SOURCE_DISPLAY_MAP[r.source] || r.source,
        key: SOURCE_DISPLAY_MAP[r.source] || r.source,
        count: parseInt(r.cnt),
      }));
    }

    return NextResponse.json({
      total,
      page,
      pageSize,
      section: section || null,
      sheet: sheet || null,
      source: source || null,
      sort,
      items,
      categories,
      zone,
    }, {
      headers: {
        // 2026-07-21: 强制 Vercel 每次重查, 修 read replica lag 导致 user 看不到新数据的 bug
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
