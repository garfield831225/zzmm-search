import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TMDB_IMG = 'https://image.tmdb.org/t/p';

async function getUser(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.replace('Bearer ', '');
    const payload = jwt.verify(token, (process.env.JWT_SECRET || 'cLWhs2015')) as any;
    const userId = String(payload.id);
    const sql = neon(process.env.DATABASE_URL || '');
    const r = await sql`SELECT id, user_group FROM xx_users WHERE id = ${userId} LIMIT 1`;
    return r[0] ? { id: r[0].id, group: String(r[0].user_group || 'user').toLowerCase() } : null;
  } catch { return null; }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { id } = await params;
  const tmdbId = parseInt(id, 10);
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'movie';

  if (!tmdbId || tmdbId < 1) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  // 1) TMDB 信息（优先 xx_tmdb_discover，再 xx_tmdb_cache）
  let tmdb: any = null;
  const discover = await sql`SELECT * FROM xx_tmdb_discover WHERE tmdb_id = ${tmdbId} AND tmdb_type = ${type} LIMIT 1`;
  if (discover[0]) {
    tmdb = discover[0];
  } else {
    const cache = await sql`SELECT * FROM xx_tmdb_cache WHERE tmdb_id = ${String(tmdbId)} LIMIT 1`;
    if (cache[0]) tmdb = cache[0];
  }

  // 兼容 origin_country 字符串/数组
  if (tmdb && typeof tmdb.origin_country === 'string') {
    tmdb.origin_country = tmdb.origin_country ? tmdb.origin_country.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
  }
  if (tmdb && !Array.isArray(tmdb.origin_country)) {
    tmdb.origin_country = [];
  }
  if (tmdb && !Array.isArray(tmdb.genres)) {
    tmdb.genres = [];
  }

  // 2) 当前用户
  const user = await getUser(request);
  const userGroup = user?.group || 'user';
  const isVipPlus = ['vip', 'admin'].includes(userGroup);

  // 3) 该 TMDB ID 下的所有资源链接（平铺）
  const resources = await sql`
    SELECT id, name, link, link_code, source, category, size, type, tags, view_count,
           pay_type, code_price, access_level, import_channel, created_at
    FROM xx_resources
    WHERE status = 'active'
      AND tmdb_id = ${String(tmdbId)}
    ORDER BY
      CASE source WHEN '115' THEN 0 WHEN 'baidu' THEN 1 WHEN 'aliyun' THEN 2 WHEN 'quark' THEN 3 ELSE 4 END,
      created_at DESC
  ` as any[];

  // 4) 计算每条链接的 canAccess
  const links = resources.map((r: any) => {
    let canAccess = true;
    let lockReason: string | null = null;

    // code 资源：vip 也要付
    if (r.access_level === 'code' && r.code_price && Number(r.code_price) > 0) {
      canAccess = false;
      lockReason = 'code';
    }
    // vip 资源：basic 不能访问
    else if (r.access_level === 'vip' && !isVipPlus) {
      canAccess = false;
      lockReason = 'vip_required';
    }
    // other 渠道：basic 不能访问
    else if (r.import_channel === 'other' && !isVipPlus) {
      canAccess = false;
      lockReason = 'vip_required';
    }

    return {
      id: r.id,
      name: r.name,
      link: r.link,
      link_code: r.link_code,
      source: r.source,
      category: r.category,
      size: r.size,
      type: r.type,
      tags: r.tags || [],
      view_count: Number(r.view_count || 0),
      pay_type: r.pay_type || 'free',
      code_price: r.code_price ? Number(r.code_price) : 0,
      access_level: r.access_level || 'basic',
      import_channel: r.import_channel || 'unknown',
      canAccess,
      lockReason,
    };
  });

  // 按 source 分组（不改变顺序，但前端可以分组）
  const sourceGroups: Record<string, typeof links> = {};
  for (const l of links) {
    const k = l.source || 'other';
    if (!sourceGroups[k]) sourceGroups[k] = [];
    sourceGroups[k].push(l);
  }

  return NextResponse.json({
    tmdb: tmdb ? {
      tmdb_id: tmdbId,
      tmdb_type: type,
      title: tmdb.title || tmdb.cached_title || '',
      original_title: tmdb.original_title,
      overview: tmdb.overview || tmdb.cached_overview,
      poster_path: tmdb.poster_path || tmdb.cached_poster,
      backdrop_path: tmdb.backdrop_path,
      release_date: tmdb.release_date,
      first_air_date: tmdb.first_air_date,
      vote_average: Number(tmdb.vote_average || 0),
      popularity: Number(tmdb.popularity || 0),
      genres: tmdb.genres || [],
      origin_country: tmdb.origin_country || [],
      runtime: tmdb.runtime,
      tagline: tmdb.tagline,
      status: tmdb.status,
    } : null,
    links,
    sourceGroups,
    counts: { total: links.length, accessible: links.filter(l => l.canAccess).length, locked: links.filter(l => !l.canAccess).length },
    user: { group: userGroup, isVipPlus, loggedIn: !!user },
    poster_base: TMDB_IMG,
  });
}
