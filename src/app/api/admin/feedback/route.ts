// 2026-07-17: Admin 反馈处理 API
// GET 列表 (按 status 过滤)
// PATCH 处理 (handled/ignored + admin_note)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authAdmin(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'cLWhs2015') as any;
    if (String(payload.user_group || payload.group || '').toLowerCase() !== 'admin') {
      return { error: '需要 admin', status: 403 };
    }
    return { adminId: Number(payload.id) };
  } catch {
    return { error: 'token 无效', status: 401 };
  }
}

// GET: 列表
export async function GET(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sql = neon(process.env.DATABASE_URL || '');

  const status = req.nextUrl.searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '100', 10), 500);

  try {
    const rows = await sql`
      SELECT f.*, r.name as resource_name, r.category as resource_category
      FROM xx_link_feedback f
      LEFT JOIN xx_resources r ON f.resource_id = r.id
      WHERE f.status = ${status}
      ORDER BY f.created_at DESC
      LIMIT ${limit}
    ` as any[];
    const totalRes = await sql`SELECT status, COUNT(*)::int as cnt FROM xx_link_feedback GROUP BY status`;
    return NextResponse.json({ ok: true, items: rows, by_status: totalRes, total: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

// PATCH: 处理反馈
// body: { id, action: 'handled'|'ignored', admin_note? }
export async function PATCH(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sql = neon(process.env.DATABASE_URL || '');

  const body = await req.json().catch(() => ({}));
  const { id, action, admin_note } = body;
  if (!id || !action) return NextResponse.json({ error: '需要 id + action' }, { status: 400 });
  if (!['handled', 'ignored'].includes(action)) return NextResponse.json({ error: 'action 必须是 handled/ignored' }, { status: 400 });

  try {
    await sql`
      UPDATE xx_link_feedback
      SET status = ${action}, admin_note = ${admin_note || ''}, handled_by = ${auth.adminId}, handled_at = NOW(), updated_at = NOW()
      WHERE id = ${id}
    `;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
