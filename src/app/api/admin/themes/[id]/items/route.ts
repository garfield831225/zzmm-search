// 2026-08-03: P5.3 admin 主题 item CRUD
//   - GET  /api/admin/themes/[id]/items     列出主题下所有 active items
//   - POST /api/admin/themes/[id]/items     加 item (body: {tmdb_id, tmdb_type, title, poster_path, backdrop_path, sort_order?})

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const themeId = parseInt(params.id);
  if (!themeId) return NextResponse.json({ error: 'id 错误' }, { status: 400 });

  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const rows = await sql`
      SELECT id, theme_id, tmdb_id, tmdb_type, title, poster_path, backdrop_path, sort_order, status, created_at
      FROM xx_theme_items
      WHERE theme_id = ${themeId} AND status = 'active'
      ORDER BY sort_order ASC, id ASC
    `;
    return NextResponse.json({
      success: true,
      items: rows.map((r: any) => ({
        id: r.id,
        themeId: r.theme_id,
        tmdbId: r.tmdb_id,
        tmdbType: r.tmdb_type,
        title: r.title,
        posterPath: r.poster_path,
        posterUrl: r.poster_path ? `${TMDB_IMAGE_BASE}${r.poster_path}` : null,
        backdropPath: r.backdrop_path,
        backdropUrl: r.backdrop_path ? `${TMDB_IMAGE_BASE}${r.backdrop_path}` : null,
        sortOrder: r.sort_order,
        status: r.status,
        createdAt: r.created_at,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const themeId = parseInt(params.id);
  if (!themeId) return NextResponse.json({ error: 'id 错误' }, { status: 400 });

  try {
    const body = await request.json();
    const { tmdb_id, tmdb_type, title, poster_path, backdrop_path, sort_order } = body;
    if (!tmdb_id || !tmdb_type || !title) {
      return NextResponse.json({ error: '缺少 tmdb_id / tmdb_type / title' }, { status: 400 });
    }
    if (!['movie', 'tv'].includes(tmdb_type)) {
      return NextResponse.json({ error: 'tmdb_type 必须是 movie/tv' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    // 检查主题存在
    const themeCheck = await sql`SELECT id FROM xx_themes WHERE id = ${themeId} AND status = 'active'`;
    if (themeCheck.length === 0) {
      return NextResponse.json({ error: '主题不存在或已删除' }, { status: 404 });
    }

    // 默认 sort_order = max + 10 (加到末尾)
    const maxOrder = await sql`SELECT COALESCE(MAX(sort_order), 0) as m FROM xx_theme_items WHERE theme_id = ${themeId}`;
    const nextOrder = sort_order || (maxOrder[0].m + 10);

    // 防重 (同 theme 下同 tmdb_id 只能 1 条)
    const dup = await sql`SELECT id FROM xx_theme_items WHERE theme_id = ${themeId} AND tmdb_id = ${tmdb_id} AND status = 'active'`;
    if (dup.length > 0) {
      return NextResponse.json({ error: '该主题下已有此 TMDB 资源' }, { status: 400 });
    }

    const rows = await sql`
      INSERT INTO xx_theme_items (theme_id, tmdb_id, tmdb_type, title, poster_path, backdrop_path, sort_order, status, created_at)
      VALUES (${themeId}, ${tmdb_id}, ${tmdb_type}, ${title}, ${poster_path || null}, ${backdrop_path || null}, ${nextOrder}, 'active', NOW())
      RETURNING id, theme_id, tmdb_id, tmdb_type, title, poster_path, backdrop_path, sort_order, status
    `;

    return NextResponse.json({ success: true, item: rows[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
