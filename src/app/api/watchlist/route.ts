// 2026-08-14: 公共 API - 用户追剧清单 (CRUD)
//   GET  /api/watchlist          - 当前用户清单
//   POST /api/watchlist          - 添加 { tmdb_id, tmdb_type, title? }
//   DELETE /api/watchlist?id=N  - 删除
//   PATCH /api/watchlist?id=N   - 改 notify_enabled / title
//   Bearer/cookie 鉴权 (跟 /api/auth/me 一样, 读 zzmm_token cookie)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};
const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function errJson(code: string, message: string, status = 400, hint?: string) {
  return NextResponse.json(
    { error: { code, message, ...(hint ? { hint } : {}) } },
    { status, headers: CORS_HEADERS }
  );
}

async function getUserId(req: NextRequest): Promise<number | null> {
  // 1. cookie
  const cookieToken = req.cookies.get('zzmm_token')?.value;
  // 2. Authorization Bearer
  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
  const token = cookieToken || bearerToken;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return parseInt(payload.id);
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return errJson('no_token', '需要 Bearer token 或 zzmm_token cookie', 401);

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`
      SELECT id, tmdb_id, tmdb_type, title, notify_enabled, created_at
      FROM xx_user_watchlist
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    ` as any[];
    return NextResponse.json({
      total: rows.length,
      items: rows.map((r: any) => ({
        id: r.id,
        tmdbId: r.tmdb_id,
        tmdbType: r.tmdb_type,
        title: r.title,
        notifyEnabled: r.notify_enabled,
        createdAt: r.created_at,
      })),
    }, { headers: CORS_HEADERS });
  } catch (e: any) {
    return errJson('internal_error', e.message || '服务器错误', 500);
  }
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return errJson('no_token', '需要 Bearer token 或 zzmm_token cookie', 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errJson('invalid_body', 'body 必须是 JSON', 400);
  }
  const tmdbId = String(body?.tmdb_id || '').trim();
  const tmdbType = String(body?.tmdb_type || 'tv').trim();
  const title = body?.title ? String(body.title).slice(0, 200) : null;
  if (!tmdbId || !/^\d+$/.test(tmdbId)) {
    return errJson('invalid_tmdb_id', 'tmdb_id 必须是数字', 400, `实际: ${tmdbId}`);
  }
  if (tmdbType !== 'movie' && tmdbType !== 'tv') {
    return errJson('invalid_tmdb_type', 'tmdb_type 必须是 movie 或 tv', 400, `实际: ${tmdbType}`);
  }

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`
      INSERT INTO xx_user_watchlist (user_id, tmdb_id, tmdb_type, title)
      VALUES (${userId}, ${tmdbId}, ${tmdbType}, ${title})
      ON CONFLICT (user_id, tmdb_id, tmdb_type) DO UPDATE SET
        title = COALESCE(EXCLUDED.title, xx_user_watchlist.title),
        notify_enabled = true
      RETURNING id, tmdb_id, tmdb_type, title, notify_enabled, created_at
    ` as any[];
    const r = rows[0];
    return NextResponse.json({
      id: r.id,
      tmdbId: r.tmdb_id,
      tmdbType: r.tmdb_type,
      title: r.title,
      notifyEnabled: r.notify_enabled,
      createdAt: r.created_at,
    }, { status: 201, headers: CORS_HEADERS });
  } catch (e: any) {
    return errJson('internal_error', e.message || '服务器错误', 500);
  }
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return errJson('no_token', '需要 Bearer token 或 zzmm_token cookie', 401);

  const id = parseInt(new URL(req.url).searchParams.get('id') || '');
  if (!id) return errJson('invalid_id', 'id 必填', 400);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errJson('invalid_body', 'body 必须是 JSON', 400);
  }
  const notifyEnabled = body?.notify_enabled;
  const title = body?.title;
  if (typeof notifyEnabled !== 'boolean' && !title) {
    return errJson('invalid_body', 'notify_enabled (boolean) 或 title (string) 必填一个', 400);
  }

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`
      UPDATE xx_user_watchlist
      SET ${notifyEnabled !== undefined ? sql`notify_enabled = ${notifyEnabled},` : sql``}
          ${title ? sql`title = ${title},` : sql``}
          id = id
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, tmdb_id, tmdb_type, title, notify_enabled
    ` as any[];
    if (rows.length === 0) {
      return errJson('not_found', '未找到或无权操作', 404);
    }
    return NextResponse.json({
      id: rows[0].id,
      tmdbId: rows[0].tmdb_id,
      tmdbType: rows[0].tmdb_type,
      title: rows[0].title,
      notifyEnabled: rows[0].notify_enabled,
    }, { headers: CORS_HEADERS });
  } catch (e: any) {
    return errJson('internal_error', e.message || '服务器错误', 500);
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return errJson('no_token', '需要 Bearer token 或 zzmm_token cookie', 401);

  const id = parseInt(new URL(req.url).searchParams.get('id') || '');
  if (!id) return errJson('invalid_id', 'id 必填', 400);

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`
      DELETE FROM xx_user_watchlist
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    ` as any[];
    if (rows.length === 0) {
      return errJson('not_found', '未找到或无权操作', 404);
    }
    return NextResponse.json({ deleted: rows[0].id }, { headers: CORS_HEADERS });
  } catch (e: any) {
    return errJson('internal_error', e.message || '服务器错误', 500);
  }
}
