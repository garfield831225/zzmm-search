import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getUser(req: NextRequest) {
  try {
    let token: string | null = null;
    // 1) Bearer header（前端主动传）
    const auth = req.headers.get('authorization');
    if (auth?.startsWith('Bearer ')) token = auth.replace('Bearer ', '');
    // 2) Cookie 兜底（httpOnly，middleware 能读，前端 JS 读不到）
    if (!token) {
      const c = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value;
      if (c) token = c;
    }
    if (!token) return null;
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
  // FAIL-SOFT: 即使 getUser 失败也继续返回数据，错误状态用 error 字段带
  const lockEnabled = process.env.LOCK_PLAYBACK_TO_VIP !== 'false';
  let user: { id: number; group: string } | null = null;
  let lockReason: string | null = null;
  if (lockEnabled) {
    user = await getUser(request);
    if (!user) {
      lockReason = 'unauthenticated';
    } else if (!['vip', 'admin'].includes(user.group)) {
      lockReason = 'vip_required';
    }
  }

  const { id } = await params;
  const tmdbId = parseInt(id, 10);
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'movie';
  if (!tmdbId) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const TMDB_KEY = process.env.TMDB_API_KEY || '7985342d5961e9ee3d5ef6d969c1b8dd';
  const url = `https://api.themoviedb.org/3/${type}/${tmdbId}/videos?api_key=${TMDB_KEY}&language=zh-CN,en-US`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) {
      return NextResponse.json({ videos: [], sources: [], error: `TMDB ${r.status}` }, { status: 502 });
    }
    const data = await r.json();
    const results: any[] = data.results || [];

    // 分类：YouTube / Vimeo
    const videos = results.map((v: any) => ({
      id: v.id,
      key: v.key,
      site: v.site,
      type: v.type,
      name: v.name,
      official: v.official,
      published_at: v.published_at,
      // embed URL
      embed_url: v.site === 'YouTube'
        ? `https://www.youtube.com/embed/${v.key}?autoplay=1`
        : v.site === 'Vimeo'
        ? `https://player.vimeo.com/video/${v.key}?autoplay=1`
        : null,
    }));

    // 跳 Keel 搜索（公开源）
    const title = (await neon(process.env.DATABASE_URL || '')`SELECT title FROM xx_tmdb_discover WHERE tmdb_id = ${tmdbId} LIMIT 1`)[0]?.title || '';
    const keelSearch = title ? `https://bdesyj9wf2tr.space.minimaxi.com/?q=${encodeURIComponent(title)}` : null;

    return NextResponse.json({
      tmdb_id: tmdbId,
      tmdb_type: type,
      videos,
      keelSearch,
      title,
      lockReason,
      isLocked: !!lockReason,
      userGroup: user?.group || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, videos: [] }, { status: 502 });
  }
}
