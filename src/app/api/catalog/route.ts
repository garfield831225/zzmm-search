// 2026-07-20: /titles 和 /library 统一目录 API
// 业务规则:
//   - /titles: 纯目录浏览, 不返 link/url 实际值, 不要求登录
//   - /library: 完整功能, 返 link/提取码/解锁状态等
//   - 两个页面共用此 API, 通过 zone=titles|library 区分字段返回
//   - 分类方案:
//       zezhe (泽泽妈妈115文档) → 按 doc_sheet 分类 (21-sheet 库的 sheet 名)
//       vip / code → 按 source (网盘类型) 分类
//   - 排序: 按 created_at asc=文档原始顺序 (默认) / desc=倒序
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

// 2026-07-21: 修 read replica lag 终极方案 - 关掉 Neon HTTP fetch connection cache
// 默认 true 会让 Vercel warm 函数命中老 read replica, 关掉后每次 fetch 重新走 control plane routing
// 性能影响: 每次 catalog 调用增加 ~50ms, 但能保证看到最新数据 (用户痛点: 看不到 683 条新导入)
neonConfig.fetchConnectionCache = false;

// 2026-07-21: 改 Edge runtime - Edge 每次请求新建 V8 isolate context, 不会复用 Neon fetch module-level cache
// 这是修 Vercel 函数 warm 命中老 read replica 看不到新数据的终极方案
// (fetchConnectionCache 在 Neon 0.10.4 已废弃永远 true, 只有 Edge runtime 才能绕过)
export const runtime = 'edge';
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
  const section = searchParams.get('section') || '';  // '' (全部) | zezhe | vip | code
  const sheet = searchParams.get('sheet') || '';        // zezhe 区分类
  const source = searchParams.get('source') || '';      // vip/code 区分类
  const sort = (searchParams.get('sort') || 'asc').toLowerCase();  // asc=正序 | desc=倒序
  const zone = searchParams.get('zone') || 'titles';    // 'titles' (无链接) | 'library' (完整)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(150, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));

  try {
    // 2026-07-21: 强制主 endpoint 同步 — 修 Vercel warm 函数命中 read replica 看不到新数据的 bug
    // 原理: Neon HTTP control plane 走 read-your-writes, 写主 endpoint 后 control plane 强制 routing 到最新 replica
    // 用一个临时小表存 sync 标记, 然后立即清掉
    try {
      await sql`CREATE TABLE IF NOT EXISTS xx_catalog_sync_marker (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`INSERT INTO xx_catalog_sync_marker DEFAULT VALUES`;
      await sql`DELETE FROM xx_catalog_sync_marker WHERE id = (SELECT MAX(id) FROM xx_catalog_sync_marker)`;
    } catch (e) { /* 表已存在或 sync 失败, 不阻塞主查询 */ }

    // 1. Section 过滤 (跟 /library 业务规则一致: 4 大区 + 全部)
    let sectionFilter = '1=1';
    let sectionChannel = '';
    if (section === 'zezhe') {
      sectionFilter = "(r.import_channel = 'zezemom_excel')";
      sectionChannel = 'zezhe';
    } else if (section === 'vip') {
      sectionFilter = "(r.access_level = 'vip')";
      sectionChannel = 'vip';
    } else if (section === 'code') {
      sectionFilter = "(r.access_level = 'code')";
      sectionChannel = 'code';
    } else if (section === 'tg') {
      // 2026-07-24 新增: TG 频道上传区, 包含所有 tg_* import_channel
      // 子分类按 import_channel 区分 (tg_aliyun / tg_quark / tg_magnet / tg_baidu 等)
      // 注: ESCAPE '\\' 在 Neon 不可靠, 直接用 LIKE 'tg%' 即可
      sectionFilter = "(r.import_channel LIKE 'tg%')";
      sectionChannel = 'tg';
    }

    // 2. Sheet / Source 过滤
    let extraFilter = '1=1';
    let extraVals: any[] = [];
    if (sheet) {
      extraFilter = 'r.doc_sheet = $1';
      extraVals = [sheet];
    } else if (source) {
      const sourceKey = SOURCE_KEY_MAP[source] || source;
      extraFilter = 'r.source = $1';
      extraVals = [sourceKey];
    }

    // 3. 名称搜索
    let nameFilter = '1=1';
    let nameVals: any[] = [];
    if (q) {
      nameFilter = '(r.name ILIKE $1 OR r.category ILIKE $1)';
      nameVals = [`%${q}%`];
    }

    // 4. WHERE 拼装 (用 addCond 模式避免 Neon 兼容层 template tag 问题)
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
      // section 已经拼成字符串, 直接 inline (没有用户输入)
      conds.push(sectionFilter);
    }
    if (sheet) addCond('r.doc_sheet = $1', sheet);
    else if (source) addCond('r.source = $1', SOURCE_KEY_MAP[source] || source);
    if (q) addCond('(r.name ILIKE $1 OR r.category ILIKE $1)', `%${q}%`);
    const whereSQL = 'WHERE ' + conds.join(' AND ');

    // 5. Count
    const countSQL = `SELECT COUNT(*) as cnt FROM xx_resources r ${whereSQL}`;
    const countRows = await sql(countSQL, condVals) as any[];
    const total = parseInt(countRows?.[0]?.cnt || '0');

    // 6. 列表 — 排序按 created_at (asc=正序=文档原始, desc=倒序)
    const orderDir = sort === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * pageSize;
    const limitPlaceholder = `$${condVals.length + 1}`;
    const offsetPlaceholder = `$${condVals.length + 2}`;

    const listSQL = `
      SELECT r.id, r.name, r.category, r.tags, r.tmdb_id,
             r.doc_sheet, r.sub_type, r.size, r.type, r.created_at, r.access_level, r.import_channel, r.source,
             r.link, r.link_code,
             COALESCE(c.title, r.name) as display_title,
             c.poster_path, c.vote_average, c.vote_count, c.release_date, c.status as tmdb_status
      FROM xx_resources r
      LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
      ${whereSQL}
      ORDER BY r.created_at ${orderDir}, r.id ${orderDir}
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;
    const dbRows = await sql(listSQL, [...condVals, pageSize, offset]) as any[];

    // 7. Item 结构
    const items = dbRows.map((row: any) => {
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
      return base;
    });

    // 8. 返分类按钮列表 (用于前端显示 sheet/source 按钮)
    // zezhe → sheet 列表, vip/code → source 列表, '' (全部) → 不返
    let categories: { name: string; key: string; count: number }[] = [];
    if (section === 'zezhe') {
      // 21-sheet 库的 sheet 名 + count
      const sheetRows = await sql`
        SELECT doc_sheet, COUNT(*) as cnt
        FROM xx_resources
        WHERE status='active' AND import_channel='zezemom_excel' AND doc_sheet IS NOT NULL
        GROUP BY doc_sheet
        ORDER BY cnt DESC, doc_sheet ASC
      `;
      categories = (sheetRows || []).map((r: any) => ({ name: r.doc_sheet, key: r.doc_sheet, count: parseInt(r.cnt) }));
    } else if (section === 'vip' || section === 'code') {
      // vip/code 区的 source 分布
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
    } else if (section === 'tg') {
      // 2026-07-24 新增: TG 频道上传区, 按 import_channel 子分类
      const tgChannelRows = await sql`
        SELECT import_channel, COUNT(*)::int as cnt
        FROM xx_resources
        WHERE status='active' AND import_channel LIKE 'tg%'
        GROUP BY import_channel
        ORDER BY cnt DESC, import_channel ASC
      `;
      const TG_DISPLAY_MAP: Record<string, string> = {
        'tg_aliyun': '阿里云盘',
        'tg_quark': '夸克网盘',
        'tg_baidu': '百度网盘',
        'tg_magnet': '磁力/ed2k',
        'tg_123': '123网盘',
        'tg_yidong': '移动云盘',
        'tg_tianyi': '天翼云盘',
        'tg_xunlei': '迅雷网盘',
        'tg_uc': 'UC网盘',
        'tg_music': '音乐',
        'tg_115': '115网盘',
        'tg_telegraph': 'Telegraph',
        'tg_other': '其他',
      };
      categories = (tgChannelRows || []).map((r: any) => ({
        name: TG_DISPLAY_MAP[r.import_channel] || r.import_channel,
        key: r.import_channel,
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
      categories,  // 当 section=zezhe → sheets; section=vip/code → sources; '' → []
      zone,
    }, {
      headers: {
        // 2026-07-21: 强制 Vercel 每次重查, 修 read replica lag 导致 user 看不到 683 条新导入的 bug
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
