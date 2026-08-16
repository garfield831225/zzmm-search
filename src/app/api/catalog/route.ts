// 2026-07-20: /titles 和 /library 统一目录 API
// 业务规则:
//   - /titles: 纯目录浏览, 不返 link/url 实际值, 不要求登录
//   - /library: 完整功能, 返 link/提取码/解锁状态等
//   - 两个页面共用此 API, 通过 zone=titles|library 区分字段返回
//   - 分类方案:
//       zezhe (泽泽妈妈115文档) → 按 doc_sheet 分类 (21-sheet 库的 sheet 名, 含 "未分类" 兜底)
//       vip / code → 按 source (网盘类型) 分类 (vip 区里 "待归类" 也是一个 source 按钮)
//   - 排序: 按 created_at asc=文档原始顺序 (默认) / desc=倒序
//
// 2026-07-27 重大修复 (用户报: library 看不到泽泽妈文档 + 不要单独"待归类"区):
//   1) 改 nodejs runtime — Edge runtime 多次 await sql() 第二次 query (副表) 偶发返空
//      (Neon serverless 在 Edge session 下 session 不持久, 副表 xx_resource_links 返 []  →  library 看不到"打开"按钮)
//   2) 主表 LEFT JOIN xx_resource_links ON resource_id 单次 query 拿全部数据, 避免 2 次 await
//   3) 用 json_agg 聚合副链接数组, 比 Map 维护简单稳
//   4) 去掉 sync_marker 写表 (有 bug: 删 0 行不报错但增加 read replica lag)
//   5) 兼容 IN ('zezhe', 'zezemom_excel') 双命名
//   6) 取消 pending section — "待归类" 改为 vip section 下的 source 分类按钮 (按用户拍板)
//
// 2026-07-27 sheet 分类修复 (用户报: "zezemom_excel 都在全部里, 但按 sheet 分类没新的"):
//   之前 sheet IS NULL 的资源 (~18868 条, 原盘类) 在 sheet 分类按钮里看不到
//   修法: sheet 分类列表加一个 "未分类 (sheet=NULL)" 按钮, 显示 sheet=NULL 的资源数
//
// 2026-08-16: 鉴权 + unlocked 字段
//   - 接收 Authorization Bearer token
//   - 查 xx_user_unlocks 表, 拿到当前 user 已解锁的资源 id 集合
//   - 在每个 item 加 unlocked 字段 (boolean)
//   - 前端根据 unlocked 决定是否显示 link
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

// 2026-08-01: 修 Neon HTTP endpoint 偶发返 stale data bug
//   (catalog 看到 7/31 11:00 那 13 条外语电影 link 没插入前的 7516, 但 DB 实际 7529)
//   - neonConfig.fetchConnectionCache = false 强制每次新 connection
//   - fetchOptions: { cache: 'no-store' } 强制 fetch 不走 Next.js cache
neonConfig.fetchConnectionCache = false;
const sql = neon(process.env.DATABASE_URL || '', {
  fetchOptions: { cache: 'no-store' },
});

// 2026-07-27: 改 nodejs runtime — 修 Edge runtime 下副表查询返空 bug
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
  'xunlei': '迅雷', 'uc': 'UC网盘', 'yidong': '移动云盘',
  'other': '⏳ 待归类',  // 2026-07-27: vip section 下"待归类"特殊 source
};
const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '夸克网盘': 'quark', '123网盘': '123', '天翼云盘': 'tianyi',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k', '迅雷链接': 'thunder',
  '迅雷': 'xunlei', 'UC网盘': 'uc', '移动云盘': 'yidong',
  '⏳ 待归类': 'other',
};

export async function GET(request: NextRequest) {
  // sql 已用 module-level Pool API (走 WebSocket + read-write, 修 HTTP endpoint stale bug)
  const { searchParams } = new URL(request.url);

  // 2026-08-16: 鉴权 (拿 user_id, 用于查 unlock 状态)
  const authHeader = request.headers.get('authorization');
  let currentUserId: number | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';
      const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
      currentUserId = Number(payload.id) || null;
    } catch { /* 匿名用户 */ }
  }

  const q = (searchParams.get('q') || '').trim();
  const section = searchParams.get('section') || '';  // '' (全部) | zezhe | vip | code
  const sheet = searchParams.get('sheet') || '';        // zezhe 区分类
  const source = searchParams.get('source') || '';      // vip/code 区分类 (含 'other' 待归类)
  const sort = (searchParams.get('sort') || 'asc').toLowerCase();
  const zone = searchParams.get('zone') || 'titles';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(150, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));

  try {
    // 1. Section 过滤 (3 大区, 没 pending 了)
    let sectionFilter = '1=1';
    let sectionChannel = '';
    if (section === 'zezhe') {
      // 兼容 'zezhe' + 'zezemom_excel' + 'admin_manual' (2026-08-16 admin 手动发布的 lumen/code 资源也算)
      sectionFilter = "(r.import_channel IN ('zezhe', 'zezemom_excel', 'admin_manual'))";
      sectionChannel = 'zezhe';
    } else if (section === 'vip') {
      sectionFilter = "(r.access_level = 'vip')";
      sectionChannel = 'vip';
    } else if (section === 'code') {
      sectionFilter = "(r.pay_type = 'code' OR r.access_level = 'code')";
      sectionChannel = 'code';
    }

    // 2. sheet=special "未分类" 标记 — 实际 query 时用 doc_sheet IS NULL
    const isUnclassifiedSheet = section === 'zezhe' && sheet === '__unclassified__';

    // 3. WHERE 拼装
    const conds: string[] = [];
    const condVals: any[] = [];
    const addCond = (condSQL: string, ...vals: any[]) => {
      const offset = condVals.length;
      const renum = condSQL.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + offset}`);
      conds.push(renum);
      condVals.push(...vals);
    };
    addCond('r.status = $1', 'active');
    if (section !== '') conds.push(sectionFilter);
    // sheet 过滤: 普通 sheet 用等值, "未分类" 用 IS NULL
    if (isUnclassifiedSheet) {
      conds.push('r.doc_sheet IS NULL');
    } else if (sheet) {
      addCond('r.doc_sheet = $1', sheet);
    } else if (source) {
      // vip/code 区的 source 过滤; 'other' = category='其他' (待归类网盘)
      if (source === 'other') {
        // 待归类: 是网盘 + category='其他' + 不是 zezhe
        conds.push("(r.source IN ('baidu','quark','aliyun','115','uc','xunlei','123','tianyi','yidong','magnet','ed2k') AND r.category = '其他')");
      } else {
        addCond('r.source = $1', SOURCE_KEY_MAP[source] || source);
      }
    }
    if (q) addCond('(r.name ILIKE $1 OR r.category ILIKE $1)', `%${q}%`);
    const whereSQL = 'WHERE ' + conds.join(' AND ');

    // 4. Count
    const countSQL = `SELECT COUNT(*) as cnt FROM xx_resources r ${whereSQL}`;
    const countRows = await sql(countSQL, condVals) as any[];
    const total = parseInt(countRows?.[0]?.cnt || '0');

    // 5. 主表 + 副表 LEFT JOIN 单次 query (json_agg 聚合副链接)
    const orderDir = sort === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * pageSize;
    const limitPlaceholder = `$${condVals.length + 1}`;
    const offsetPlaceholder = `$${condVals.length + 2}`;

    const listSQL = `
      SELECT r.id, r.name, r.category, r.tags, r.tmdb_id, r.lumen_cost, r.code_price, r.pay_type,
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

    // 6. Item 结构
    // 2026-08-16: 查当前 user 的 unlock 状态, 给 item 加 unlocked 字段
    //   - 只对 payType='lumen'/'code' 的资源有意义
    //   - admin 默认全解锁
    //   - 已解锁 → 前端显示 link; 未解锁 → 前端显示解锁按钮
    const unlockedIds = new Set<number>();
    if (currentUserId) {
      try {
        const uRows = await sql`SELECT id, user_group FROM xx_users WHERE id = ${currentUserId} LIMIT 1` as any[];
        if (uRows[0]?.user_group === 'admin') {
          // admin 全解锁 — 标所有 row.id
          dbRows.forEach((r: any) => unlockedIds.add(r.id));
        } else {
          const unlocks = await sql`SELECT resource_id FROM xx_user_unlocks WHERE user_id = ${currentUserId}` as any[];
          unlocks.forEach((u: any) => unlockedIds.add(u.resource_id));
        }
      } catch { /* 失败降级为全未解锁 */ }
    }

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
      if (zone === 'library') {
        base.link = row.link || '';
        base.linkCode = row.link_code || '';
        base.lumenCost = row.lumen_cost || 1;
        base.codePrice = row.code_price ? Number(row.code_price) : 0;
        base.payType = row.pay_type || 'free';
      }
      // 2026-08-16: 加 unlocked 字段 (供前端 payType=lumen/code 时决定显示链接)
      base.unlocked = unlockedIds.has(row.id);
      // 2026-08-16: payType='lumen'/'code' 且未解锁 → 隐藏 link/url
      //   (admin 手动发布的单资源付费必须先流明解锁, 否则看不到)
      const hideLink = (row.pay_type === 'lumen' || row.pay_type === 'code') && !base.unlocked;
      if (subLinks && subLinks.length > 0 && !hideLink) {
        base.links = subLinks;
      } else if (row.link && !hideLink) {
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
      if (hideLink) {
        base.link = '';
        base.linkCode = '';
      }
      return base;
    });

    // 7. 分类按钮列表
    //    zezhe → 21-sheet 名 + "未分类" (sheet=NULL 兜底)
    //    vip → source 分布 + "⏳ 待归类" 按钮
    //    code → source 分布
    let categories: { name: string; key: string; count: number }[] = [];
    if (section === 'zezhe') {
      // 7a. 21-sheet 库的 sheet 名 + count
      const sheetRows = await sql`
        SELECT doc_sheet, COUNT(*) as cnt
        FROM xx_resources
        WHERE status='active' AND import_channel IN ('zezhe', 'zezemom_excel') AND doc_sheet IS NOT NULL
        GROUP BY doc_sheet
        ORDER BY cnt DESC, doc_sheet ASC
      `;
      // 2026-08-01 DEBUG: 已删除, 改用 Pool API 走 WebSocket 解决 stale
      // (catalog HTTP endpoint 看到 stale 7/31 11:00 那 13 条外语电影 link 不存在, 但 DB 实际 7529)
      // (Pool 走 WebSocket + TCP, 强制 read-write, 不走 HTTP read replica)
      categories = (sheetRows || []).map((r: any) => ({ name: r.doc_sheet, key: r.doc_sheet, count: parseInt(r.cnt) }));
      // 7b. 追加 "未分类" (sheet=NULL 的, 大多是原盘类, 18868 条)
      const unclassifiedRow = await sql`
        SELECT COUNT(*)::int as cnt
        FROM xx_resources
        WHERE status='active' AND import_channel IN ('zezhe', 'zezemom_excel') AND doc_sheet IS NULL
      `;
      if (unclassifiedRow[0]?.cnt > 0) {
        categories.push({ name: '📦 未分类 (原盘等)', key: '__unclassified__', count: parseInt(unclassifiedRow[0].cnt) });
      }
    } else if (section === 'vip' || section === 'code') {
      // 7c. 网盘 source 分布
      const accessLevel = section;
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
      // 2026-07-27 用户拍板: "待归类"不要单独按钮, 分散到每个网盘
      // 上面 SQL 已经包含 sheet=NULL "待归类"资源 (每个网盘 count 是该 source 下全部 vip 资源)
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
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
