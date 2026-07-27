// 2026-07-21: 回退 - Edge runtime 不支持 jsonwebtoken, 用 Node.js 走原路径
// 用 Vercel API 强制 cold start 来绕开 read replica 缓存
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

// 2026-07-21: 修 read replica lag 终极方案 - 关掉 Neon HTTP fetch connection cache
// 默认 true 会让 Vercel warm 函数命中老 read replica, 关掉后每次 fetch 重新走 control plane routing
// (Neon 0.10.4 已废弃但保留 console.warn, 实际还有部分生效)
neonConfig.fetchConnectionCache = false;

const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '夸克网盘': 'quark', '123网盘': '123', '天翼云盘': 'tianyi',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k', '迅雷链接': 'thunder',
};
const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};
const CATEGORIES = ['全部', '连载', '电影', '剧集', '动漫', '少儿频道', '综艺', '演唱会', '纪录片', '原盘', 'REMUX', '系列电影'];
const NONFILM_CATEGORIES = ['全部', '音乐', '体育', '游戏', '电子书', '精品课', '文档'];
const NONFILM_CATS = ['音乐', '体育', '游戏', '电子书', '精品课', '文档'];

// 地区 → 国家代码映射（与 TMDB iso_3166_1 一致）
const REGION_CODES: Record<string, string[]> = {
  '大陆': ['CN'],
  '欧美': ['US', 'GB', 'FR', 'DE', 'IT', 'ES', 'CA', 'AU', 'NZ'],
  '日韩': ['JP', 'KR'],
  '港澳台': ['HK', 'TW', 'MO'],
};

// 异步 fetch TMDB 详情并写 cache（search 路由调用，fire-and-forget）
async function fetchAndCacheTmdb(tmdbId: string): Promise<any | null> {
  const sql = neon(process.env.DATABASE_URL || '');
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;
  for (const t of ['tv', 'movie']) {
    try {
      const r = await fetch(`https://api.themoviedb.org/3/${t}/${tmdbId}?api_key=${key}&language=zh-CN`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (!d?.id) continue;
      const title = d.title || d.name;
      const orig = d.original_title || d.original_name;
      const countries = (d.production_countries || []).map((c: any) => c.iso_3166_1).filter(Boolean);
      const genres = (d.genres || []).map((g: any) => g.name);
      const release = d.release_date || d.first_air_date || null;
      await sql`
        INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, original_title, overview, poster_path, vote_average, vote_count, release_date, status, tagline, genres, origin_country, cached_at)
        VALUES (
          ${tmdbId}, ${t}, ${title}, ${orig}, ${d.overview || null},
          ${d.poster_path || ''}, ${d.vote_average || 0}, ${d.vote_count || 0},
          ${release}, ${d.status || null}, ${d.tagline || null},
          ${genres}::text[], ${countries.join(',')}, NOW()
        )
        ON CONFLICT (tmdb_id) DO UPDATE SET
          title = EXCLUDED.title, original_title = EXCLUDED.original_title,
          overview = EXCLUDED.overview, poster_path = EXCLUDED.poster_path,
          vote_average = EXCLUDED.vote_average, vote_count = EXCLUDED.vote_count,
          release_date = EXCLUDED.release_date, status = EXCLUDED.status,
          tagline = EXCLUDED.tagline, genres = EXCLUDED.genres,
          origin_country = EXCLUDED.origin_country, cached_at = NOW()
      `;
      return d;
    } catch { continue; }
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    // 2026-07-20: 每次请求 new sql, 避免 Vercel 函数 warm 状态复用旧 connection (连到 lag endpoint)
    //   Neon 0.10.4 serverless driver 内部 connection cache 是 module-level 缓存
    //   但 function invocation 之间不共享, 每次 new client 应该是新 connection
    //   实际行为: 加 no-store response header 让 CDN 强制重新查, 避免 5+ 分钟 lag
    const sql = neon(process.env.DATABASE_URL || '');

    // 2026-07-21: 强制主 endpoint 同步 - 用 Neon read-your-writes 特性, 修 Vercel 函数 warm 命中 read replica 看不到新数据
    // 原理: INSERT 一定走主 endpoint, 然后 control plane 会 routing 同一 session 的后续 SELECT 到能 read-your-writes 的 replica (主或最新)
    try {
      await sql`CREATE TABLE IF NOT EXISTS xx_search_sync_marker (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`INSERT INTO xx_search_sync_marker DEFAULT VALUES`;
      await sql`DELETE FROM xx_search_sync_marker WHERE id = (SELECT MAX(id) FROM xx_search_sync_marker)`;
    } catch (e) { /* 同步失败不阻塞主查询 */ }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const category = searchParams.get('category') || '全部';
    const source = searchParams.get('source') || '全部';
    const region = searchParams.get('region') || '全部';
    const year = searchParams.get('year') || '全部';
    const sort = searchParams.get('sort') || 'release_date';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(150, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));
    const sheet = searchParams.get('sheet') || '';
    const zone = searchParams.get('zone') || 'film';
    const isLibraryZone = zone === 'library';

    // ─── WHERE clauses (用 sql(string, values) 形式, neon 接受 raw 字符串 + 参) ───
    // 2026-07-20: 重构 - 修 Vercel 上 ${var} 字符串拼接静默返 0 的 Neon 兼容层 bug.
    // 关键: 不能用 sql\`${prev} AND ${next}\` 链式 (会参数化 inner Query), 必须:
    //   1) 条件列表 + 对应 values
    //   2) 手工 renumber $N 占位符
    //   3) 最终用 sql(wholeSQL, values) 调用
    const conds: string[] = [];
    const condVals: any[] = [];
    const addCond = (condSQL: string, ...vals: any[]) => {
      const offset = condVals.length;
      const renum = condSQL.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + offset}`);
      conds.push(renum);
      condVals.push(...vals);
    };

    addCond('r.status = $1', 'active');

    if (category === '全部' && zone === 'film') {
      addCond('NOT (r.category = ANY($1::text[]))', [NONFILM_CATS]);
    } else if (category === '全部' && zone === 'nonfilm') {
      addCond('r.category = ANY($1::text[])', [NONFILM_CATS]);
    } else if (category !== '全部') {
      addCond('r.category = $1', category);
    }

    if (source !== '全部') {
      addCond('r.source = $1', SOURCE_KEY_MAP[source] || source);
    }

    if (year !== '全部' && zone === 'film') {
      if (['2026','2025','2024','2023','2022','2021','2020'].includes(year)) {
        addCond('c.release_date LIKE $1', year + '-%');
      } else if (year === '2010-2019') {
        addCond("c.release_date >= '2010-01-01' AND c.release_date <= '2019-12-31'");
      } else if (year === '2000-2009') {
        addCond("c.release_date >= '2000-01-01' AND c.release_date <= '2009-12-31'");
      }
    }

    if (q.trim()) {
      addCond('(r.name ILIKE $1 OR r.category ILIKE $1)', `%${q.trim()}%`);
    }

    const regionCodes = REGION_CODES[region];
    if (regionCodes) {
      const regionParts: string[] = [];
      regionParts.push("c.origin_country IS NOT NULL AND c.origin_country <> ''");
      for (const c of regionCodes) {
        const offset = condVals.length;
        regionParts.push(`(c.origin_country LIKE $${offset + 1})`);
        condVals.push('%' + c + '%');
      }
      addCond('(' + regionParts.join(' OR ') + ')');
    }

    // 预解析 userGroup
    let userGroup: string = 'user';
    try {
      let token: string | null = null;
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.replace('Bearer ', '');
      } else {
        const cookieToken = request.cookies.get('zzmm_token')?.value;
        if (cookieToken) token = cookieToken;
      }
      if (token) {
        const payload = jwt.verify(token, (process.env.JWT_SECRET || 'cLWhs2015')) as any;
        const userId = String(payload.id);
        userGroup = (payload.group || 'user').toLowerCase();
        const userRow = await sql`SELECT user_group FROM xx_users WHERE id = ${userId} LIMIT 1`;
        if (userRow[0]?.user_group) userGroup = String(userRow[0].user_group).toLowerCase();
      }
    } catch { /* 未登录或无效 token → userGroup='user' */ }

    if (isLibraryZone) {
      if (['admin', 'vip', 'basic', 'member'].includes(userGroup)) {
        addCond("r.access_level IN ('basic', 'vip', 'code')");
      } else {
        addCond('1=0');
      }
    } else if (['admin', 'vip'].includes(userGroup)) {
      addCond("r.access_level IN ('basic', 'vip', 'code')");
    } else if (['basic', 'member'].includes(userGroup)) {
      // basic 用户 → 看全部资源 (VIP 锁 = 前端展示, 不卡后端)
    } else {
      addCond('1=0');
    }

    const basicZezheOnly = process.env.BASIC_ZEZHE_ONLY === 'true';
    const isVipPlus = ['vip', 'admin'].includes(userGroup);
    if (basicZezheOnly && !isVipPlus) {
      addCond("r.import_channel = 'zezhe'");
    }

    if (sheet) {
      addCond('r.doc_sheet = $1', sheet);
    }

    const whereSQL = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';

    // 排序逻辑: dateWeight/orderClause 是固定字符串 (无用户数据), 内联安全
    const dateWeight = `(CASE
      WHEN c.release_date IS NULL OR c.release_date = '' THEN 1
      WHEN c.release_date < CURRENT_DATE::text THEN 0
      ELSE 1
    END)`;
    const orderClause = sort === 'added_time'
      ? `has_tmdb DESC, ${dateWeight}, r.created_at DESC`
      : sort === 'import_time_asc'
        ? `r.created_at ASC, r.id ASC`
        : sort === 'hot'
          ? `has_tmdb DESC, (COALESCE(r.view_count, 0) + COALESCE(NULLIF(c.vote_count, '')::int, 0) / 100) DESC, ${dateWeight}`
          : sort === 'rating'
            ? `has_tmdb DESC, c.vote_average DESC NULLS LAST, COALESCE(NULLIF(c.vote_count, '')::int, 0) DESC, ${dateWeight}`
            : sort === 'cover_first'
              ? `has_cover DESC, ${dateWeight}, sort_date DESC NULLS LAST, r.created_at DESC`
              : `has_tmdb DESC, ${dateWeight}, sort_date DESC NULLS LAST, r.created_at DESC`;
    const offset = (page - 1) * pageSize;

    // ─── Count ────────────────────────────────────────────────────────────────
    // 2026-07-27: 改成 distinct count (按 tmdb_id), 跟 fetch 同步, 否则 total 跟 items 数对不上
    const countSQL = `SELECT COUNT(DISTINCT CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN r.tmdb_id END) as cnt FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id ${whereSQL}`;
    const countRows = await sql(countSQL, condVals) as any[];
    const total = parseInt(countRows?.[0]?.cnt || '0');

    // ─── Fetch page ─────────────────────────────────────────────────────────
    // 2026-07-27: SQL 层 dedup by tmdb_id (用 ROW_NUMBER() PARTITION BY)
    // 旧逻辑: 拿 30 条 + 应用层 dedup 剩 17 条, 用户每页额定 30 实际只看到十几
    // 新逻辑: 内层 ROW_NUMBER 按 tmdb_id 分组取第一, 外层 ORDER BY + LIMIT 真拿到 30 部不同电影
    const limitPlaceholder = `$${condVals.length + 1}`;
    const offsetPlaceholder = `$${condVals.length + 2}`;
    const listSQL = `
      SELECT * FROM (
        SELECT r.id, r.name, r.link, r.link_code, r.source, r.category, r.size, r.type, r.tags, r.tmdb_id, r.view_count, r.created_at,
               r.doc_sheet, r.sub_type, r.lumen_cost,
               r.pay_type, r.code_price, r.lumen_cost, r.access_level, r.access_tier,
               r.import_channel,
               COALESCE(c.release_date, r.created_at::text) as sort_date,
               ${dateWeight} as date_weight,
               CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb,
               CASE WHEN EXISTS (SELECT 1 FROM xx_music_cache m WHERE m.resource_id = r.id)
                     OR EXISTS (SELECT 1 FROM xx_sports_cache s WHERE s.resource_id = r.id)
                    THEN 1 ELSE 0 END as has_cover,
               ROW_NUMBER() OVER (PARTITION BY CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN r.tmdb_id END ORDER BY ${orderClause.replace(/r\./g, 'r.')}) as rn
        FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
        ${whereSQL}
      ) sub
      WHERE rn = 1
      ORDER BY ${orderClause}
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;
    const dbRows = await sql(listSQL, [...condVals, pageSize, offset]) as any[];

    // ─── Batch TMDB cache ────────────────────────────────────────────────────
    const allIds = dbRows.map(r => r.id).filter(Boolean);
    const allTmdbIds: string[] = [];
    const seenTmdb = new Set<string>();
    dbRows.forEach(r => {
      if (r.tmdb_id && !seenTmdb.has(r.tmdb_id)) { seenTmdb.add(r.tmdb_id); allTmdbIds.push(r.tmdb_id); }
    });

    let tmdbMap = new Map<string, any>();
    const missingTmdbIds: string[] = [];
    if (allTmdbIds.length > 0) {
      const ids = await sql`SELECT * FROM xx_tmdb_cache WHERE tmdb_id = ANY(${allTmdbIds})`;
      tmdbMap = new Map((ids || []).map((info: any) => [info?.tmdb_id, info]));
      allTmdbIds.forEach(id => { if (!tmdbMap.has(id)) missingTmdbIds.push(id); });
    }

    if (missingTmdbIds.length > 0 && process.env.TMDB_API_KEY) {
      const toFetch = missingTmdbIds.slice(0, 5);
      toFetch.forEach(tmdbId => {
        fetchAndCacheTmdb(tmdbId).catch(() => {}).then(info => {
          if (info) tmdbMap.set(tmdbId, info);
        });
      });
    }

    // ─── Batch music/cover/sports ──────────────────────────────────────────
    let musicCoverMap = new Map<number, any>();
    let coverCacheMap = new Map<number, any>();
    let sportsCoverMap = new Map<number, any>();
    if (allIds.length > 0) {
      try {
        const musicRows = await sql`SELECT resource_id, artist, album, cover_url FROM xx_music_cache WHERE resource_id = ANY(${allIds})`;
        musicCoverMap = new Map((musicRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { musicCoverMap = new Map(); }
      try {
        const coverRows = await sql`SELECT resource_id, cover_url, source, extra_data FROM xx_cover_cache WHERE resource_id = ANY(${allIds})`;
        coverCacheMap = new Map((coverRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { coverCacheMap = new Map(); }
      try {
        const sportsRows = await sql`SELECT resource_id, team_name, team_alternate, stadium, league, badge_url, banner_url, description FROM xx_sports_cache WHERE resource_id = ANY(${allIds})`;
        sportsCoverMap = new Map((sportsRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { sportsCoverMap = new Map(); }
    }

    // ─── 1对N 多链接 ──────────────────────────────────────────────────────
    let linksMap = new Map<number, any[]>();
    if (allIds.length > 0) {
      try {
        const linkRows = await sql`
          SELECT resource_id, source, url, password, sort, access_level, status
          FROM xx_resource_links
          WHERE resource_id = ANY(${allIds})
            AND status = 'active'
            AND (source IS NOT NULL)
          ORDER BY resource_id, sort ASC, id ASC
        `;
        for (const lr of (linkRows || [])) {
          if (!linksMap.has(lr.resource_id)) linksMap.set(lr.resource_id, []);
          linksMap.get(lr.resource_id)!.push({
            source: lr.source,
            url: lr.url,
            password: lr.password,
            sort: lr.sort,
            accessLevel: lr.access_level,
            status: lr.status,
          });
        }
      } catch { linksMap = new Map(); }
    }

    // ─── 用户解锁资源（仅 film 区）────────────────────────────────────
    const userUnlockedIds = new Set<number>();
    if (zone === 'film' && allIds.length > 0 && userGroup !== 'user') {
      try {
        const authHeader = request.headers.get('authorization');
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.replace('Bearer ', '');
          const payload = jwt.verify(token, (process.env.JWT_SECRET || 'cLWhs2015')) as any;
          const userId = String(payload.id);
          const unlocked = await sql`SELECT resource_id FROM xx_user_unlocks WHERE user_id = ${userId} AND resource_id = ANY(${allIds})`;
          unlocked.forEach((r: any) => userUnlockedIds.add(r.resource_id));
        }
      } catch { /* 未登录或无效 token */ }
    }

    // ─── Map results ────────────────────────────────────────────────────────
    const TV_CATS_FILTER = new Set(['连载', '剧集', '动漫', '综艺', '少儿频道', '纪录片']);
    const MOVIE_CATS_FILTER = new Set(['电影', '华语电影', '外语电影', '动画电影', '演唱会', 'REMUX', '系列电影']);
    const expectedType = (cat: string): 'tv' | 'movie' | null => {
      if (TV_CATS_FILTER.has(cat)) return 'tv';
      if (MOVIE_CATS_FILTER.has(cat)) return 'movie';
      return null;
    };

    const items = dbRows.map((item: any) => {
      const cacheInfo = item.tmdb_id ? tmdbMap.get(item.tmdb_id) : null;
      const exp = expectedType(item.category);
      const tmdbOk = !cacheInfo || !exp || cacheInfo.tmdb_type === exp;
      const subLinks = linksMap.get(item.id);
      const hasSubLinks = subLinks && subLinks.length > 0;
      return {
        id: item.id,
        name: item.name,
        link: item.link || '',
        linkCode: item.link_code || '',
        source: SOURCE_DISPLAY_MAP[item.source] || item.source || '',
        sourceKey: item.source || '',
        category: item.category || '',
        size: item.size || '',
        type: item.type || '',
        tags: item.tags ? (Array.isArray(item.tags) ? item.tags : []) : [],
        docSheet: item.doc_sheet || '',
        subType: item.sub_type || '',
        tmdbIdRaw: item.tmdb_id || '',
        tmdbId: tmdbOk ? (item.tmdb_id || null) : null,
        viewCount: item.view_count || 0,
        payType: item.pay_type || 'free',
        accessLevel: item.access_level || 'basic',
        accessTier: item.access_tier || 'document',
        importChannel: item.import_channel || '',
        codePrice: item.code_price ? Number(item.code_price) : 0,
        lumenCost: item.lumen_cost ?? 1,
        unlocked: userUnlockedIds.has(item.id),
        tmdb: tmdbOk && item.tmdb_id ? (tmdbMap.get(item.tmdb_id) || null) : null,
        musicCover: item.category === '音乐' ? (musicCoverMap.get(item.id) || null) : null,
        coverCache: !item.tmdb_id ? (coverCacheMap.get(item.id) || null) : null,
        sportsCover: item.category === '体育' ? (sportsCoverMap.get(item.id) || null) : null,
        links: hasSubLinks ? subLinks : (item.link ? [{ source: item.source, url: item.link, password: item.link_code, sort: 1, accessLevel: item.access_level, status: 'active' }] : []),
      };
    });

    // 2026-07-10: 应用层 dedup by tmdb_id
    // 2026-07-20: 加 dedupBy 参数支持, 保留原始 items 用于 groups
    const dedupByParam = searchParams.get('dedupBy') || 'tmdb_id';
    // 计算 groups (按 tmdb_id 分组, 含 name 用于前端展示)
    const groupsMap = new Map<string, { tmdbId: string; name: string; count: number }>();
    for (const it of items) {
      const tid = it.tmdbIdRaw || 'null';
      if (!groupsMap.has(tid)) {
        groupsMap.set(tid, {
          tmdbId: it.tmdbIdRaw || '',
          name: it.name || '',
          count: 0,
        });
      }
      groupsMap.get(tid)!.count++;
    }
    const groups = Array.from(groupsMap.values()).sort((a, b) => b.count - a.count);

    // 应用 dedup
    // 2026-07-20: dedupBy=tmdb_id 默认去重, dedupBy=id 保留全部
    const shouldDedup = dedupByParam === 'tmdb_id';
    if (shouldDedup) {
      const seen = new Set<string>();
      const deduped: any[] = [];
      for (const it of items) {
        const tid = it.tmdbIdRaw;
        if (!tid) {
          deduped.push(it);
          continue;
        }
        if (seen.has(tid)) continue;
        seen.add(tid);
        deduped.push(it);
      }
      items.length = 0;
      items.push(...deduped);
    }

    return NextResponse.json({
      total,
      page,
      pageSize,
      items,
      groups,  // 2026-07-20: 按 tmdb_id 分组 (含 name + count), 前端做"显示重复"按钮
      dedupBy: shouldDedup ? 'tmdb_id' : 'id',
      categories: zone === 'film' ? CATEGORIES : NONFILM_CATEGORIES,
      sources: ['全部', ...Object.values(SOURCE_DISPLAY_MAP)],
    }, {
      headers: {
        // 2026-07-20: 强制不缓存, 防 Vercel CDN 缓存老数据
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error: any) {
    console.error('Search error:', error.message);
    return NextResponse.json({ error: '搜索失败: ' + error.message }, { status: 500 });
  }
}
