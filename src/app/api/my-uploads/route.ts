// 2026-08-15: /api/my-uploads - 当前用户的所有上传历史
//   业务规则:
//     - 任何登录 user 可用 (basic / vip / admin)
//     - 查 xx_pending_resources WHERE user_id = current
//     - 包含所有 status (pending / approved / rejected)
//     - admin 上传是 status='approved' (走 xx_pending_resources) 也能看到
//     - JOIN xx_upcoming 拿 TMDB title + poster
//   跟 /api/admin/pending 区别: 不鉴权 admin, 只返当前 user 自己的

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { jwtVerify } from 'jose';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'cLWhs2015');
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

async function getUserId(request: NextRequest): Promise<number | null> {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const { payload } = await jwtVerify(auth.slice(7), JWT_SECRET);
      return Number(payload.id) || null;
    } catch {}
  }
  const cookieToken = request.cookies.get('zzmm_token')?.value || request.cookies.get('token')?.value;
  if (cookieToken) {
    try {
      const { payload } = await jwtVerify(cookieToken, JWT_SECRET);
      return Number(payload.id) || null;
    } catch {}
  }
  return null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 查所有 status (pending / approved / rejected) + JOIN xx_upcoming 拿 title/poster
    const rows = await sql`
      SELECT
        p.id, p.tmdb_id, p.name, p.type, p.links, p.size, p.size_unit, p.note,
        p.status, p.submitted_at, p.reviewed_at, p.rejection_reason,
        up.title as tmdb_title,
        up.tmdb_type as tmdb_type,
        up.poster_path as tmdb_poster
      FROM xx_pending_resources p
      LEFT JOIN xx_upcoming up ON up.id = (
        SELECT id FROM xx_upcoming WHERE tmdb_id = p.tmdb_id::int LIMIT 1
      )
      WHERE p.user_id = ${userId}
      ORDER BY p.submitted_at DESC
      LIMIT 100
    ` as any[];

    return NextResponse.json({
      success: true,
      items: rows.map((r: any) => {
        const links = typeof r.links === 'string' ? JSON.parse(r.links) : r.links;
        return {
          id: r.id,
          tmdbId: r.tmdb_id,
          tmdbTitle: r.tmdb_title || r.name,
          tmdbType: r.tmdb_type,
          tmdbPosterUrl: r.tmdb_poster ? `${TMDB_IMAGE_BASE}${r.tmdb_poster}` : null,
          name: r.name,
          type: r.type,
          links: links || [],
          linkCount: Array.isArray(links) ? links.length : 0,
          size: r.size,
          sizeUnit: r.size_unit,
          note: r.note,
          status: r.status,
          submittedAt: r.submitted_at,
          reviewedAt: r.reviewed_at,
          rejectionReason: r.rejection_reason,
        };
      }),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
