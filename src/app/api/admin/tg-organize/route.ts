// /api/admin/tg-organize - TG 群整理候选列表 + 审核
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

// GET 列表 + 统计
export async function GET(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || 'pending';
  const limit = Math.min(500, parseInt(searchParams.get('limit') || '100'));

  try {
    let rows;
    if (status === 'all') {
      rows = await sql`SELECT id, title, type, source, source_id, raw_data, status, uploaded_by, created_at, updated_at
                         FROM xx_import_candidates ORDER BY created_at DESC LIMIT ${limit}` as any[];
    } else {
      rows = await sql`SELECT id, title, type, source, source_id, raw_data, status, uploaded_by, created_at, updated_at
                         FROM xx_import_candidates WHERE status = ${status} ORDER BY created_at DESC LIMIT ${limit}` as any[];
    }

    // 转换为页面需要的格式
    const items = rows.map(r => {
      const raw = r.raw_data && typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : (r.raw_data || {});
      return {
        id: r.id,
        group_name: raw.group_name || raw.group || r.source || '未知群',
        message_id: raw.message_id || raw.msg_id || r.source_id,
        message_text: raw.message_text || raw.text || r.title || '',
        raw_links: raw.raw_links || raw.links || [],
        detected_resources: raw.detected_resources || raw.items || [],
        source: r.source,
        created_at: r.created_at,
        status: r.status,
        reviewed_by: r.uploaded_by,
        reviewed_at: r.updated_at,
      };
    });

    const stats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE status = 'approved')::int as approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::int as rejected,
        COUNT(*)::int as total
      FROM xx_import_candidates
    ` as any[];

    return NextResponse.json({ ok: true, items, stats: stats[0] || { pending: 0, approved: 0, rejected: 0, total: 0 } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST 审核 (approve / reject)
export async function POST(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const body = await req.json().catch(() => ({}));
  const { id, action } = body;

  if (!id || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'id + action (approve/reject) 必填' }, { status: 400 });
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  try {
    await sql`UPDATE xx_import_candidates SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;
    return NextResponse.json({ ok: true, id, status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE 删除
export async function DELETE(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get('id') || '0');

  if (!id) return NextResponse.json({ error: '缺 id' }, { status: 400 });
  try {
    await sql`DELETE FROM xx_import_candidates WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}