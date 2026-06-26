export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

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

function esc(s: string) { return s.replace(/'/g, "''"); }

// 异步 fetch TMDB 详情并写 cache（search 路由调用，fire-and-forget）
async function fetchAndCacheTmdb(tmdbId: string): Promise<any | null> {
  const sql = neon(process.env.DATABASE_URL || '');
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;
  // 先试 tv 再试 movie
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
    const sql = neon(process.env.DATABASE_URL || '');
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
    // 2026-06-26: /library 公开资源库 - 登录后可见 (basic/user 都行)
    // zone=library 时不走强 access_level 过滤, 让 user 组也能浏览
    const isLibraryZone = zone === 'library';

    // ─── WHERE clauses (inline strings — no param placeholders) ─────────────
    const catFilter = category === '全部' && zone === 'film'
      ? NONFILM_CATS.map(c => `r.category != '${esc(c)}'`).join(' AND ')
      : category === '全部' && zone === 'nonfilm'
      ? `r.category IN ('${NONFILM_CATS.map(esc).join("','")}')`
      : category !== '全部' ? `r.category = '${esc(category)}'` : '1=1';

    const sourceFilter = source !== '全部'
      ? `r.source = '${esc(SOURCE_KEY_MAP[source] || source)}'` : '1=1';

    const yearFilter = year !== '全部' && zone === 'film'
      ? (['2026','2025','2024','2023','2022','2021','2020'].includes(year)
        ? `(c.release_date LIKE '${year}-%')`
        : year === '2010-2019' ? "(c.release_date >= '2010-01-01' AND c.release_date <= '2019-12-31')"
        : year === '2000-2009' ? "(c.release_date >= '2000-01-01' AND c.release_date <= '2009-12-31')"
        : '1=1')
      : '1=1';

    const nameFilter = q.trim()
      ? `(r.name ILIKE '%${esc(q.trim())}%' OR r.category ILIKE '%${esc(q.trim())}%')`
      : '1=1';

    // 地区筛选：依赖 xx_tmdb_cache.origin_country（match 脚本写入）
    // 没 cache 的资源允许通过，等下次匹配
    const regionCodes = REGION_CODES[region];
    const regionFilter = regionCodes
      ? `(c.origin_country IS NOT NULL AND c.origin_country <> '' AND (${regionCodes.map(c => `c.origin_country LIKE '%${c}%'`).join(' OR ')}))`
      : '1=1';

    // 2026-06-04: access_level 过滤（userGroup 会在下方赋值）
    // 默认 basic 限制；下方根据实际 userGroup 重新生成
    let accessLevelFilter = "(r.access_level = 'basic')";

    // 2026-06-06: 预解析 userGroup（用于 import_channel 灰度过滤）
    // 灰度开关 BASIC_ZEZHE_ONLY=true 才生效；默认 false → 不影响老用户
    // 2026-06-26: 任何 zone 都要解析 userGroup (library/nonfilm 也要根据权限过滤)
    let userGroup: string = 'user';
    try {
      // 2026-06-26: 同时支持 Bearer header 和 zzmm_token cookie (前者优先)
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
    // 2026-06-09: 按 userGroup 动态生成 access_level 过滤
    // admin/vip → 全部; basic → document(泽泽妈文档)+单资源付费; user → 空
    // 2026-06-26: 没 free 类别了, 未登录/user 组一律返空 → 必须激活 basic
    // 2026-06-26: /library 公开资源库 - basic+ 才能看, user 组和未登录 → 0 条
    if (isLibraryZone) {
      // /library 公开页: 必须 basic/vip/admin 才能看 (用户要求)
      if (['admin', 'vip', 'basic', 'member'].includes(userGroup)) {
        accessLevelFilter = "(r.access_level IN ('basic', 'vip', 'code'))";
      } else {
        // 未登录 / user 组 → 0 条
        accessLevelFilter = "(1=0)";
      }
    } else if (['admin', 'vip'].includes(userGroup)) {
      accessLevelFilter = "(r.access_level IN ('basic', 'vip', 'code'))";
    } else if (['basic', 'member'].includes(userGroup)) {
      // basic 用户 (泽泽妈文档激活码激活后的等级) → 能看泽泽妈文档 + 单资源付费
      accessLevelFilter = "(r.access_level IN ('basic', 'code'))";
    } else {
      // 未登录 / 普通 free / user 组 → 0 条结果, 必须先去激活
      accessLevelFilter = "(1=0)";
    }
    // 额外: code 资源 (单资源付费) 需要在 xx_user_unlocks 有记录 → 这里只过 access_level, 具体逻辑在 list 阶段补
    const basicZezheOnly = process.env.BASIC_ZEZHE_ONLY === 'true';
    const isVipPlus = ['vip', 'admin'].includes(userGroup);
    const importChannelFilter = (basicZezheOnly && !isVipPlus)
      ? `(r.import_channel = 'zezhe')` : '1=1';

    // 2026-06-26: 21 sheet 文档库模式 - 按 sheet (doc_sheet 字段) 过滤
    const sheetFilter = sheet ? `(r.doc_sheet = '${esc(sheet)}')` : '1=1';

    const whereClause = `r.status = 'active' AND ${catFilter} AND ${sourceFilter} AND ${regionFilter} AND ${yearFilter} AND ${nameFilter} AND ${accessLevelFilter} AND ${importChannelFilter} AND ${sheetFilter}`;

    // 排序逻辑：
    //   1) has_tmdb DESC（有 TMDB 排前面）
    //   2) "已播完"优先（release_date < 今天）— 未来日期沉到底
    //   3) 上映时间降序 / 上架时间降序
    //   4) r.created_at DESC（兜底）
    const dateWeight = `(CASE
      WHEN c.release_date IS NULL OR c.release_date = '' THEN 1
      WHEN c.release_date < CURRENT_DATE::text THEN 0
      ELSE 1
    END)`;
    const orderClause = sort === 'added_time'
      ? `has_tmdb DESC, ${dateWeight}, r.created_at DESC`
      : sort === 'hot'
        // 2026-06-26: 热度 = view_count + TMDB 投票数/100 + 最近天数加分, 整数计算避免类型不匹配
        ? `has_tmdb DESC, (COALESCE(r.view_count, 0) + COALESCE(NULLIF(c.vote_count, '')::int, 0) / 100) DESC, ${dateWeight}`
        : sort === 'rating'
          // 评分 = TMDB vote_average (高到低), 有数据优先
          ? `has_tmdb DESC, c.vote_average DESC NULLS LAST, COALESCE(NULLIF(c.vote_count, '')::int, 0) DESC, ${dateWeight}`
          : `has_tmdb DESC, ${dateWeight}, sort_date DESC NULLS LAST, r.created_at DESC`;
    const offset = (page - 1) * pageSize;

    // ─── Count ────────────────────────────────────────────────────────────────
    const countRows = await sql(`SELECT COUNT(*) as cnt FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE ${whereClause}`) as any[];
    const total = parseInt(countRows?.[0]?.cnt || '0');

    // ─── Fetch page ─────────────────────────────────────────────────────────
    const dbRows = await sql(`
      SELECT r.id, r.name, r.link, r.link_code, r.source, r.category, r.size, r.type, r.tags, r.tmdb_id, r.view_count, r.created_at,
             r.doc_sheet, r.sub_type, r.lumen_cost,
             r.pay_type, r.code_price, r.lumen_cost, r.access_level, r.access_tier,
             COALESCE(c.release_date, r.created_at::text) as sort_date,
             ${dateWeight} as date_weight,
             CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb
      FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ${pageSize} OFFSET ${offset}
    `) as any[];

    // ─── Batch TMDB cache ────────────────────────────────────────────────────
    const allIds = dbRows.map(r => r.id).filter(Boolean);
    const allTmdbIds: string[] = [];
    const seen = new Set<string>();
    dbRows.forEach(r => {
      if (r.tmdb_id && !seen.has(r.tmdb_id)) { seen.add(r.tmdb_id); allTmdbIds.push(r.tmdb_id); }
    });

    let tmdbMap = new Map<string, any>();
    const missingTmdbIds: string[] = [];
    if (allTmdbIds.length > 0) {
      const ids = await sql(`SELECT * FROM xx_tmdb_cache WHERE tmdb_id IN (${allTmdbIds.map(id => `'${esc(id)}'`).join(',')})`);
      tmdbMap = new Map((ids || []).map((info: any) => [info?.tmdb_id, info]));
      // 找没 cache 的 tmdb_id，后台异步 fetch 写 cache（不阻塞主返回）
      allTmdbIds.forEach(id => { if (!tmdbMap.has(id)) missingTmdbIds.push(id); });
    }

    // 异步补 missing cache（fire-and-forget，用户刷新就有了）
    if (missingTmdbIds.length > 0 && process.env.TMDB_API_KEY) {
      // 限流：一次最多补 5 个，避免 TMDB rate limit
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
      const idsStr = allIds.map(id => `${id}`).join(',');
      try {
        const musicRows = await sql(`SELECT resource_id, artist, album, cover_url FROM xx_music_cache WHERE resource_id IN (${idsStr})`);
        musicCoverMap = new Map((musicRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { musicCoverMap = new Map(); }
      try {
        const coverRows = await sql(`SELECT resource_id, cover_url, source, extra_data FROM xx_cover_cache WHERE resource_id IN (${idsStr})`);
        coverCacheMap = new Map((coverRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { coverCacheMap = new Map(); }
      try {
        const sportsRows = await sql(`SELECT resource_id, team_name, team_alternate, stadium, league, badge_url, banner_url, description FROM xx_sports_cache WHERE resource_id IN (${idsStr})`);
        sportsCoverMap = new Map((sportsRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { sportsCoverMap = new Map(); }
    }

    // ─── 用户解锁资源（仅 film 区）────────────────────────────────────
    // userGroup 已在上面预解析（用于 import_channel 过滤）
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
    // 类别 → 期望的 cache.tmdb_type（不匹配则清空 tmdb，不显示海报）
    const TV_CATS_FILTER = new Set(['连载', '剧集', '动漫', '综艺', '少儿频道', '纪录片']);
    const MOVIE_CATS_FILTER = new Set(['电影', '华语电影', '外语电影', '动画电影', '演唱会', 'REMUX', '系列电影']);
    const expectedType = (cat: string): 'tv' | 'movie' | null => {
      if (TV_CATS_FILTER.has(cat)) return 'tv';
      if (MOVIE_CATS_FILTER.has(cat)) return 'movie';
      return null; // 原盘/合集/音乐/体育等
    };

    const items = dbRows.map((item: any) => {
      // 类别错配过滤：category 要求 tv，但 cache 是 movie（或反之）→ 不返回 tmdb 字段
      const cacheInfo = item.tmdb_id ? tmdbMap.get(item.tmdb_id) : null;
      const exp = expectedType(item.category);
      const tmdbOk = !cacheInfo || !exp || cacheInfo.tmdb_type === exp;
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
        accessLevel: item.access_level || 'basic',  // 2026-06-04
        accessTier: item.access_tier || 'document',  // 2026-06-25 资源分级
        codePrice: item.code_price ? Number(item.code_price) : 0,
        lumenCost: item.lumen_cost ?? 1,  // 2026-06-25 单条定价流明
        unlocked: userUnlockedIds.has(item.id),
        tmdb: tmdbOk && item.tmdb_id ? (tmdbMap.get(item.tmdb_id) || null) : null,
        musicCover: item.category === '音乐' ? (musicCoverMap.get(item.id) || null) : null,
        coverCache: !item.tmdb_id ? (coverCacheMap.get(item.id) || null) : null,
        sportsCover: item.category === '体育' ? (sportsCoverMap.get(item.id) || null) : null,
      };
    });

    return NextResponse.json({
      total,
      page,
      pageSize,
      items,
      categories: zone === 'film' ? CATEGORIES : NONFILM_CATEGORIES,
      sources: ['全部', ...Object.values(SOURCE_DISPLAY_MAP)],
    });
  } catch (error: any) {
    console.error('Search error:', error.message);
    return NextResponse.json({ error: '搜索失败: ' + error.message }, { status: 500 });
  }
}
