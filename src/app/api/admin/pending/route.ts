// 2026-08-03: P6.2 admin pending 审核列表
//   - GET /api/admin/pending   列出所有 status='pending' 的资源 (按 submitted_at 倒序)
//   - 含 TMDB 标题 + 用户名 + 链接数 + 大小 + 备注

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

export async function GET(request: NextRequest) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 拿 pending + approved 列表
    // 2026-08-04: P6.2 SQL bug 修复
    //   - 之前 LEFT JOIN xx_upcoming u 然后 SELECT u.username → xx_upcoming 没 username 字段
    //   - 改成 LEFT JOIN xx_users uu 拿 username, xx_upcoming 单独拿 title/poster
    const rows = await sql`
      SELECT
        p.id, p.user_id, p.tmdb_id, p.name, p.type, p.links, p.size, p.size_unit, p.note,
        p.status, p.submitted_at, p.reviewed_at, p.reviewed_by, p.rejection_reason,
        uu.username,
        up.title as tmdb_title,
        up.poster_path as tmdb_poster
      FROM xx_pending_resources p
      LEFT JOIN xx_users uu ON uu.id = p.user_id
      LEFT JOIN xx_upcoming up ON up.id = (
        SELECT id FROM xx_upcoming WHERE tmdb_id = p.tmdb_id::int LIMIT 1
      )
      ORDER BY
        CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END,
        p.submitted_at DESC
      LIMIT 200
    `;

    return NextResponse.json({
      success: true,
      items: rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        username: r.username,
        tmdbId: r.tmdb_id,
        tmdbTitle: r.tmdb_title || r.name,
        tmdbPosterUrl: r.tmdb_poster ? `${TMDB_IMAGE_BASE}${r.tmdb_poster}` : null,
        name: r.name,
        type: r.type,
        links: typeof r.links === 'string' ? JSON.parse(r.links) : r.links,
        linkCount: Array.isArray(typeof r.links === 'string' ? JSON.parse(r.links) : r.links) ? (typeof r.links === 'string' ? JSON.parse(r.links) : r.links).length : 0,
        size: r.size,
        sizeUnit: r.size_unit,
        note: r.note,
        status: r.status,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        reviewedBy: r.reviewed_by,
        rejectionReason: r.rejection_reason,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
