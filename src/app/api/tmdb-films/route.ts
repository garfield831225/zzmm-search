import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TMDB_IMG = 'https://image.tmdb.org/t/p';

interface UserInfo {
  id: number;
  group: string;
}

async function getUser(req: NextRequest): Promise<UserInfo | null> {
  try {
    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.replace('Bearer ', '');
    const payload = jwt.verify(token, (process.env.JWT_SECRET || 'cLWhs2015')) as any;
    const userId = String(payload.id);
    const sql = neon(process.env.DATABASE_URL || '');
    const r = await sql`SELECT id, "group" FROM xx_users WHERE id = ${userId} LIMIT 1`;
    return r[0] ? { id: r[0].id, group: String(r[0].group || 'user').toLowerCase() } : null;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  try {
    return await _GET(request);
  } catch (e: any) {
    console.error('TMDB-FILMS API ERR:', e?.message, e?.stack?.slice(0, 800));
    return NextResponse.json({ error: e?.message || 'unknown', stack: e?.stack?.slice(0, 800) }, { status: 500 });
  }
}

async function _GET(request: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(request.url);
  const type       = searchParams.get('type') || 'movie';          // movie | tv
  const category   = searchParams.get('category') || 'all';        // all | movie | tv | anime | doc | variety
  const year       = searchParams.get('year') || '';                // 2025 | 2010-2019 | ...
  const genre      = searchParams.get('genre') || '';                // 中文名
  const minRating  = parseFloat(searchParams.get('minRating') || '0');
  const sort       = searchParams.get('sort') || 'smart';           // smart | release_date | popularity | rating
  const page       = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize   = Math.max(1, Math.min(parseInt(searchParams.get('pageSize') || '50'), 500));  // 默认 50 条/页（避免 Vercel 60s 超时）
  const linkType   = searchParams.get('linkType') || 'all';         // all | 115 | baidu | ...
  const keyword    = (searchParams.get('q') || '').trim();

  const user = await getUser(request);
  const userGroup = user?.group || 'user';
  const isVipPlus = ['vip', 'admin'].includes(userGroup);

  // ─── 类别映射（前端 category → resources.category）────────────────
  const catMap: Record<string, string[]> = {
    all: [],
    movie: ['电影', '华语电影', '外语电影', '动画电影', '演唱会', 'REMUX', '系列电影'],
    tv: ['剧集', '连载'],
    anime: ['动漫', '少儿频道'],
    doc: ['纪录片'],
    variety: ['综艺'],
  };
  const cats = catMap[category] || [];

  // ─── 拼装结果（整体排序：1 块 → 2 块 → 3 块，整个 list 统一按 release_date DESC）──
  // 搜索模式（keyword 非空）：跨 3 块全量搜，不分页，SQL 层 ILIKE
  // 整体排序：每个 item 给一个 sort_key
  //   b1: release_date || first_air_date || cache_release || '1900-01-01'
  //   b2: created_at （没 release_date，用 created_at fallback）
  //   b3: release_date || first_air_date || '1900-01-01'
  // 然后整个 list 统一按 sort_key DESC 排（不分块）

  const isSearch = !!keyword;
  const kw = (keyword || '').toLowerCase();
  const offset1 = isSearch ? 0 : (page - 1) * pageSize;
  const limit1 = isSearch ? 500 : pageSize;

  // ─── b1/b2/b3 块 SQL：cats/linkType/type **字面拼**（不参数化），只用 $1/$2/$3 给 type/limit/offset ──
  // **关键**：Neon v3 按最大 $N 编号推断 params 数量，字面拼避免 $N 错位
  const catsIn = cats.length ? ` AND r.category IN (${cats.map(c => `'${c.replace(/'/g, "''")}'`).join(',')})` : '';
  const linkIn = linkType === '115' ? ` AND r.source = '115'`
    : linkType === 'baidu' ? ` AND r.source = 'baidu'`
    : linkType === 'other' ? ` AND r.source NOT IN ('115','baidu','aliyun','quark')`
    : '';
  const typeIn = type === 'tv' ? ` AND r.category IN ('剧集','连载','动漫','少儿频道','综艺','纪录片')`
    : type === 'movie' ? ` AND r.category IN ('电影','华语电影','外语电影','动画电影','演唱会','REMUX','系列电影')`
    : '';
  const resourceWhere = `r.status = 'active'${catsIn}${linkIn}${typeIn}`;

  // 1 块 SQL：用户已导入 + 已匹配（按 release_date DESC，搜索时多拉后内存 ILIKE）
  // **关键**：type/limit/offset 全字面拼，**SQL 字符串里 0 个 $N 占位符**，params = []
  // 之前报错"could not determine $1"是 Neon v3 对 LIMIT/JOIN ON 子句里的 $N 推断有问题
  // **统一 sort_key**：release_date || first_air_date || '1900-01-01'（3 块都用同一字段对齐）
  const block1 = await sql(`
    WITH matched AS (
      SELECT r.tmdb_id::int as tmdb_id, MAX(r.updated_at) as updated_at,
             MAX(r.view_count) as view_count, COUNT(*) as link_count
      FROM xx_resources r
      WHERE r.tmdb_id IS NOT NULL
        AND r.tmdb_id != ''
        AND r.tmdb_id != 'NOMATCH'
        AND (r.tmdb_id)::int > 10000
        AND r.tmdb_id NOT IN ('GARBLED','NOTFOUND','NULL','0','-1')
        AND ${resourceWhere}
      GROUP BY r.tmdb_id
    )
    SELECT m.tmdb_id, m.view_count, m.link_count, m.updated_at,
           d.tmdb_type, d.title, d.original_title, d.poster_path, d.backdrop_path,
           d.release_date, d.first_air_date, d.vote_average, d.popularity,
           d.genres, d.origin_country, d.overview,
           c.title as cached_title, c.poster_path as cached_poster, c.overview as cached_overview,
           c.release_date as cache_release,
           COALESCE(c.release_date, d.release_date, d.first_air_date, '1900-01-01') as sort_key
    FROM matched m
    LEFT JOIN xx_tmdb_discover d ON d.tmdb_id = m.tmdb_id AND d.tmdb_type = '${type.replace(/'/g, "''")}'
    LEFT JOIN xx_tmdb_cache c ON c.tmdb_id = m.tmdb_id::text
    ORDER BY sort_key DESC NULLS LAST
    LIMIT ${limit1} OFFSET ${offset1}
  `) as any[];

  // 2 块 SQL：用户已导入 + 未匹配（按 created_at DESC，搜索时多拉后内存 ILIKE）
  // sort_key = r.created_at::text 跟 b1/b3 的 release_date string 维度对齐
  const offset2 = isSearch ? 0 : (page - 1) * pageSize;
  const limit2 = isSearch ? 500 : pageSize;
  const block2 = await sql(`
    SELECT id, name, link, link_code, source, category, size, view_count, created_at,
           to_char(r.created_at, 'YYYY-MM-DD') as sort_key
    FROM xx_resources r
    WHERE ${resourceWhere}
      AND (r.tmdb_id IS NULL OR r.tmdb_id = '' OR r.tmdb_id = 'NOMATCH')
    ORDER BY r.created_at DESC
    LIMIT ${limit2} OFFSET ${offset2}
  `) as any[];

  // 3 块 SQL：TMDB 全量 ∖ 用户已导入（按 release_date DESC，搜索时多拉后内存 ILIKE）
  const offset3 = isSearch ? 0 : (page - 1) * pageSize;
  const limit3 = isSearch ? 500 : pageSize;
  const block3 = await sql(`
    SELECT tmdb_id, tmdb_type, title, original_title, poster_path, backdrop_path,
           release_date, first_air_date, vote_average, popularity,
           genres, origin_country, overview,
           COALESCE(release_date, first_air_date, '1900-01-01') as sort_key
    FROM xx_tmdb_discover
    WHERE tmdb_type = '${type.replace(/'/g, "''")}'
      AND poster_path IS NOT NULL
      AND tmdb_id NOT IN (
        SELECT DISTINCT (r.tmdb_id)::int FROM xx_resources r
        WHERE r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND r.tmdb_id != 'NOMATCH'
          AND (r.tmdb_id)::int > 10000
          AND r.tmdb_id NOT IN ('GARBLED','NOTFOUND','NULL','0','-1')
          AND r.status = 'active'
      )
    ORDER BY sort_key DESC NULLS LAST
    LIMIT ${limit3} OFFSET ${offset3}
  `) as any[];

  // 真实总数（不带 LIMIT，3 个独立 COUNT；**字面拼，无 $N**，跟 b1/b2/b3 一致）
  const count1 = await sql(`
    SELECT COUNT(DISTINCT r.tmdb_id)::int as cnt FROM xx_resources r
    WHERE r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND r.tmdb_id != 'NOMATCH'
      AND (r.tmdb_id)::int > 10000
      AND r.tmdb_id NOT IN ('GARBLED','NOTFOUND','NULL','0','-1')
      AND ${resourceWhere}
  `) as any[];
  const count2 = await sql(`
    SELECT COUNT(*)::int as cnt FROM xx_resources r
    WHERE ${resourceWhere}
      AND (r.tmdb_id IS NULL OR r.tmdb_id = '' OR r.tmdb_id = 'NOMATCH')
  `) as any[];
  const count3 = await sql(`
    SELECT COUNT(*)::int as cnt FROM xx_tmdb_discover
    WHERE tmdb_type = '${type.replace(/'/g, "''")}'
      AND poster_path IS NOT NULL
      AND tmdb_id NOT IN (
        SELECT DISTINCT (r.tmdb_id)::int FROM xx_resources r
        WHERE r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND r.tmdb_id != 'NOMATCH'
          AND (r.tmdb_id)::int > 10000
          AND r.tmdb_id NOT IN ('GARBLED','NOTFOUND','NULL','0','-1')
          AND r.status = 'active'
      )
  `) as any[];

  // ─── 关键词过滤（搜索时在内存做，避免 SQL 模板与字符串拼接冲突）────────
  let b1 = block1, b2 = block2, b3 = block3;
  if (isSearch) {
    b1 = b1.filter((r: any) => (r.title || '').toLowerCase().includes(kw) || (r.cached_title || '').toLowerCase().includes(kw) || (r.original_title || '').toLowerCase().includes(kw));
    b2 = b2.filter((r: any) => (r.name || '').toLowerCase().includes(kw));
    b3 = b3.filter((r: any) => (r.title || '').toLowerCase().includes(kw) || (r.original_title || '').toLowerCase().includes(kw));
  }

  // 年份过滤
  if (year) {
    const yf = (r: any) => r.release_date || r.first_air_date || r.cache_release || '';
    if (year === '2010-2019') {
      b1 = b1.filter(r => { const d = yf(r); return d >= '2010' && d < '2020'; });
      b3 = b3.filter(r => { const d = yf(r); return d >= '2010' && d < '2020'; });
    } else if (year === '2000-2009') {
      b1 = b1.filter(r => { const d = yf(r); return d >= '2000' && d < '2010'; });
      b3 = b3.filter(r => { const d = yf(r); return d >= '2000' && d < '2010'; });
    } else {
      b1 = b1.filter(r => yf(r).startsWith(year));
      b3 = b3.filter(r => yf(r).startsWith(year));
    }
  }

  // 评分过滤
  if (minRating > 0) {
    b1 = b1.filter(r => (r.vote_average || 0) >= minRating);
    b3 = b3.filter(r => (r.vote_average || 0) >= minRating);
  }

  // 类型过滤（genre 是中文名）
  if (genre) {
    b1 = b1.filter(r => (r.genres || []).includes(genre));
    b3 = b3.filter(r => (r.genres || []).includes(genre));
  }

  // 排序
  const dateOf = (r: any) => r.release_date || r.first_air_date || r.cache_release || '1900';
  if (sort === 'release_date') {
    b1.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    b3.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  } else if (sort === 'popularity') {
    b1.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    b3.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  } else if (sort === 'rating') {
    b1.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    b3.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  } else {
    // smart：1 块按 updated_at（用户最新导入在前），3 块按 popularity
    b1.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    b3.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  }

  // ─── 拼装结果（整体排序：1 块 → 2 块 → 3 块，各自按自己规则排满 pageSize 条）──
  const items = [
    ...b1.slice(0, pageSize).map((r: any) => {
      const sk = r.sort_key || r.release_date || r.first_air_date || r.cache_release || '1900-01-01';
      return {
        block: 1,
        tmdb_id: Number(r.tmdb_id),
        tmdb_type: r.tmdb_type,
        title: r.cached_title || r.title || '',
        original_title: r.original_title,
        poster_path: r.cached_poster || r.poster_path,
        backdrop_path: r.backdrop_path,
        release_date: r.release_date || r.cache_release,
        first_air_date: r.first_air_date,
        vote_average: Number(r.vote_average || 0),
        popularity: Number(r.popularity || 0),
        genres: r.genres || [],
        origin_country: r.origin_country || [],
        overview: r.cached_overview || r.overview,
        has_resource: true,
        link_count: Number(r.link_count || 1),
        view_count: Number(r.view_count || 0),
        sort_key: sk,
      };
    }),
    ...b2.slice(0, pageSize).map((r: any) => {
      const sk = r.sort_key || '1900-01-01';
      return {
        block: 2,
        id: r.id,
        name: r.name,
        link: r.link,
        link_code: r.link_code,
        source: r.source,
        category: r.category,
        size: r.size,
        view_count: Number(r.view_count || 0),
        has_resource: true,
        has_tmdb: false,
        sort_key: sk,
      };
    }),
    ...b3.slice(0, pageSize).map((r: any) => {
      const sk = r.sort_key || r.release_date || r.first_air_date || '1900-01-01';
      return {
        block: 3,
        tmdb_id: r.tmdb_id,
        tmdb_type: r.tmdb_type,
        title: r.title,
        original_title: r.original_title,
        poster_path: r.poster_path,
        backdrop_path: r.backdrop_path,
        release_date: r.release_date,
        first_air_date: r.first_air_date,
        vote_average: Number(r.vote_average || 0),
        popularity: Number(r.popularity || 0),
        genres: r.genres || [],
        origin_country: r.origin_country || [],
        overview: r.overview,
        has_resource: false,
        sort_key: sk,
      };
    }),
  ];

  // 整体按 sort_key DESC 统一重排（b1/b2/b3 混排，不再分块）
  // sort_key 来自 SQL（b1=release_date||first_air_date, b2=created_at, b3=release_date||first_air_date）
  items.sort((a, b) => String(b.sort_key || '').localeCompare(String(a.sort_key || '')));

  return NextResponse.json({
    debug: { cats, type, year, genre, linkType, sort, page, pageSize, keyword, offset1, offset2, offset3 },
    page,
    pageSize,
    items,
    counts: {
      block1: count1[0]?.cnt || 0,
      block2: count2[0]?.cnt || 0,
      block3: count3[0]?.cnt || 0,
      hasMore1: b1.length === pageSize,
      hasMore2: b2.length === pageSize,
      hasMore3: b3.length === pageSize,
    },
    user: { group: userGroup, isVipPlus },
    poster_base: TMDB_IMG,
  });
}
