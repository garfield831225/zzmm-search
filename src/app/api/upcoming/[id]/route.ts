// 2026-08-03: P6.1 待上传详情 API
//   - GET /api/upcoming/[id]   查 TMDB + approved (xx_resources) + 我自己的 pending (xx_pending_resources)

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { jwtVerify } from 'jose';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'cLWhs2015');
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

async function getUser(request: NextRequest): Promise<{ id: number; group: string; username: string } | null> {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const { payload } = await jwtVerify(auth.slice(7), JWT_SECRET);
      return { id: Number(payload.id), group: String(payload.user_group || payload.group || ''), username: String(payload.username || '') };
    } catch {}
  }
  const cookieToken = request.cookies.get('zzmm_token')?.value || request.cookies.get('token')?.value;
  if (cookieToken) {
    try {
      const { payload } = await jwtVerify(cookieToken, JWT_SECRET);
      return { id: Number(payload.id), group: String(payload.user_group || payload.group || ''), username: String(payload.username || '') };
    } catch {}
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id);
  if (!id) return NextResponse.json({ error: 'id 错误' }, { status: 400 });

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });
    const tmdbRows = await sql`SELECT id, tmdb_id, tmdb_type, title, poster_path, backdrop_path, overview, release_date FROM xx_upcoming WHERE id = ${id}::int`;
    if (tmdbRows.length === 0) {
      return NextResponse.json({ error: '找不到该 TMDB 记录' }, { status: 404 });
    }
    const tmdb = tmdbRows[0];

    // approved (xx_resources 匹配 tmdb_id)
    const approvedRows = await sql`
      SELECT id, name, source, link, link_code, category, access_level, created_at
      FROM xx_resources
      WHERE tmdb_id = ${String(tmdb.tmdb_id)} AND status = 'active'
      ORDER BY created_at DESC LIMIT 20
    `;

    // 我自己的 pending
    const user = await getUser(request);
    let pendingRows: any[] = [];
    if (user) {
      pendingRows = await sql`
        SELECT id, name, type, links, size, size_unit, note, status, submitted_at
        FROM xx_pending_resources
        WHERE tmdb_id = ${String(tmdb.tmdb_id)} AND user_id = ${user.id} AND status = 'pending'
        ORDER BY submitted_at DESC
      `;
    }

    return NextResponse.json({
      tmdb: {
        id: tmdb.id,
        tmdbId: tmdb.tmdb_id,
        tmdbType: tmdb.tmdb_type,
        title: tmdb.title,
        posterPath: tmdb.poster_path,
        posterUrl: tmdb.poster_path ? `${TMDB_IMAGE_BASE}${tmdb.poster_path}` : null,
        backdropPath: tmdb.backdrop_path,
        backdropUrl: tmdb.backdrop_path ? `${TMDB_IMAGE_BASE}${tmdb.backdrop_path}` : null,
        overview: tmdb.overview,
        releaseDate: tmdb.release_date,
      },
      approved: approvedRows.map((r: any) => ({
        resourceId: r.id,
        name: r.name,
        source: r.source?.replace(/ \[deleted\]$/, ''),
        link: r.link,
        linkCode: r.link_code,
        category: r.category,
        accessLevel: r.access_level,
        createdAt: r.created_at,
      })),
      pending: pendingRows.map((p: any) => ({
        pendingId: p.id,
        name: p.name,
        type: p.type,
        links: typeof p.links === 'string' ? JSON.parse(p.links) : p.links,
        size: p.size,
        sizeUnit: p.size_unit,
        note: p.note,
        status: p.status,
        submittedAt: p.submitted_at,
      })),
      currentUser: user ? { id: user.id, group: user.group, username: user.username } : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
