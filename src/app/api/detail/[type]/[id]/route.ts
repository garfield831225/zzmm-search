// 2026-08-13: 公共 API - 影视详情 (moviezone + 子站调用)
//   GET /api/detail/[type]/[id]?userGroup=basic
//   - Bearer admin/vip 鉴权 (route 内 verify)
//   - userGroup query: user/basic/vip/admin 决定每条 link 的 locked 状态
//   - TMDB metadata 从 xx_tmdb_cache 拿
//   - 资源从 xx_resources 拿 (复用 /api/tmdb-resources 的 type IS NULL 兼容逻辑)
//   - locked 规则:
//     - import_channel='zezhe' → locked=false (永远不锁, basic + vip 都能直接打开)
//     - access_tier='document' → locked=false (basic 也能看)
//     - access_tier='vip' && userGroup in (user, basic) → locked=true (VIP 锁)
//     - lumen_cost > 0 → locked=true (单资源付费, basic + vip 都要流明解锁)
//   - 错误格式: { error: { code, message, hint? } }
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const VALID_TYPES = new Set(['movie', 'tv']);
const VALID_GROUPS = new Set(['user', 'basic', 'member', 'vip', 'admin']);

const SOURCE_ORDER = ['115', 'baidu', 'quark', 'aliyun', 'xunlei', '123pan', 'tianyi', 'uc', 'cmcc', 'pikpak', 'magnet', 'ed2k'];

function errJson(code: string, message: string, hint?: string, status = 400) {
  return NextResponse.json(
    { error: { code, message, ...(hint ? { hint } : {}) } },
    { status, headers: CORS_HEADERS }
  );
}

function getAuth(req: NextRequest): { ok: true; group: string } | { ok: false; status: number; code: string; message: string } {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return { ok: false, status: 401, code: 'no_token', message: '缺少 Authorization Bearer token' };
  }
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET) as any;
    const g = String(payload.user_group || payload.group || '').toLowerCase();
    if (g !== 'vip' && g !== 'admin') {
      return { ok: false, status: 403, code: 'forbidden', message: '需要 admin / vip token' };
    }
    return { ok: true, group: g };
  } catch {
    return { ok: false, status: 401, code: 'invalid_token', message: 'Token 无效或过期' };
  }
}

function isLocked(link: any, userGroup: string): boolean {
  // 2026-08-13: 按用户原话 "VIP 锁 = 前端展示, 不是后端过滤"
  //   - basic 看所有 (BFF 不过滤), 非 zezhe 显示 VIP 锁
  //   - vip 看所有没锁
  //   - zezhe 永远不锁
  //   - pay_type='code' 永远 💰 解锁 (除 admin)
  //   - admin 全开
  if (userGroup === 'admin') return false;
  if (link.import_channel === 'zezhe') return false;
  if (link.pay_type === 'code') return true;
  if (userGroup === 'vip') return false;
  // user / basic / member 看到非 zezhe 资源 → 锁
  return true;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest, { params }: { params: { type: string; id: string } }) {
  // 1. Bearer 鉴权
  const auth = getAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: CORS_HEADERS }
    );
  }

  // 2. 入参校验
  const type = params.type;
  const tmdbId = params.id;
  if (!VALID_TYPES.has(type)) {
    return errJson('invalid_type', `type 必须是 movie 或 tv`, `实际: ${type}`, 400);
  }
  if (!tmdbId || !/^\d+$/.test(tmdbId)) {
    return errJson('invalid_tmdb_id', `tmdb id 必须是数字`, `实际: ${tmdbId}`, 400);
  }
  const { searchParams } = new URL(req.url);
  const userGroup = (searchParams.get('userGroup') || 'user').toLowerCase();
  if (!VALID_GROUPS.has(userGroup)) {
    return errJson('invalid_user_group', `userGroup 必须是 user/basic/vip/admin 之一`, `实际: ${userGroup}`, 400);
  }

  try {
    const sql = neon(process.env.DATABASE_URL || '');

    // 3. TMDB metadata (poster, overview, vote, year, genres)
    const tmdbRows = await sql`
      SELECT tmdb_id, tmdb_type, title, original_title, overview, poster_path,
             vote_average, vote_count, release_date, status, tagline, genres,
             origin_country
      FROM xx_tmdb_cache
      WHERE tmdb_id = ${tmdbId} AND expires_at > NOW()
      LIMIT 1
    ` as any[];
    const tmdb = tmdbRows[0] || null;

    // 4. 资源链接 (跟 /api/tmdb-resources 一致的 type 兼容逻辑)
    const rows = await sql`
      SELECT id, name, link, link_code, source, size, lumen_cost,
             access_tier, access_level, access_tier, import_channel, doc_sheet,
             sub_type, status, pay_type, code_price, created_at, updated_at
      FROM xx_resources
      WHERE tmdb_id = ${tmdbId} AND status = 'active'
        AND (type IS NULL OR type = '' OR type = 'other' OR type = ${type})
      ORDER BY source, created_at DESC
    ` as any[];

    // 5. 按 source 分组 + 加 locked
    const bySourceMap = new Map<string, any[]>();
    for (const r of rows) {
      const src = r.source || 'unknown';
      if (!bySourceMap.has(src)) bySourceMap.set(src, []);
      const locked = isLocked(r, userGroup);
      bySourceMap.get(src)!.push({
        id: r.id,
        name: r.name,
        url: r.link,
        password: r.link_code || '',
        size: r.size || '',
        lumenCost: Number(r.lumen_cost) || 0,
        accessTier: r.access_tier,
        accessLevel: r.access_level,
        importChannel: r.import_channel,
        payType: r.pay_type,
        locked,
        createdAt: r.created_at,
      });
    }

    const links = Array.from(bySourceMap.entries())
      .sort((a, b) => {
        const ai = SOURCE_ORDER.indexOf(a[0]);
        const bi = SOURCE_ORDER.indexOf(b[0]);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .map(([code, items]) => ({ source: code, count: items.length, items }));

    // 6. 返回结构
    return NextResponse.json({
      tmdb: tmdb ? {
        id: tmdb.tmdb_id,
        type: tmdb.tmdb_type,
        title: tmdb.title,
        originalTitle: tmdb.original_title,
        overview: tmdb.overview,
        posterPath: tmdb.poster_path,
        voteAverage: tmdb.vote_average ? parseFloat(tmdb.vote_average) : null,
        voteCount: tmdb.vote_count,
        releaseDate: tmdb.release_date,
        status: tmdb.status,
        tagline: tmdb.tagline,
        genres: tmdb.genres,
        originCountry: tmdb.origin_country,
      } : null,
      links,
      total: rows.length,
      userGroup,
      hasMore: false,
    }, { headers: CORS_HEADERS });
  } catch (e: any) {
    console.error('[api/detail] error:', e.message);
    return NextResponse.json(
      { error: { code: 'internal_error', message: e.message || '服务器错误' } },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
