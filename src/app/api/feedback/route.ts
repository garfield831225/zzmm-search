// 2026-07-17: 用户反馈 API
// POST 提交反馈
// GET 查自己的历史
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuth(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'cLWhs2015') as any;
    return { userId: Number(payload.id), username: String(payload.username || 'unknown') };
  } catch {
    return { error: 'token 无效', status: 401 };
  }
}

const VALID_REASONS = ['失效', '限速', '密码错', '内容错', '其他'];

// POST: 提交反馈
// body: { resourceId, source, reason, comment?, newPassword? }
export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sql = neon(process.env.DATABASE_URL || '');

  const body = await req.json().catch(() => ({}));
  const { resourceId, source, reason, comment, newPassword } = body;
  if (!resourceId || !source || !reason) {
    return NextResponse.json({ error: '需要 resourceId + source + reason' }, { status: 400 });
  }
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: `reason 必须是: ${VALID_REASONS.join('/')}` }, { status: 400 });
  }
  if (reason === '其他' && !comment?.trim()) {
    return NextResponse.json({ error: 'reason=其他 必须填备注' }, { status: 400 });
  }

  try {
    // 查 link_id (新模型, link_id 可空 = 老资源没副表)
    const link = await sql`SELECT id FROM xx_resource_links WHERE resource_id = ${resourceId} AND source = ${source} AND status = 'active' LIMIT 1` as any[];
    const linkId = link[0]?.id || null;

    await sql`
      INSERT INTO xx_link_feedback (link_id, resource_id, user_id, username, source, reason, comment, new_password, status)
      VALUES (${linkId}, ${resourceId}, ${auth.userId}, ${auth.username}, ${source}, ${reason}, ${comment || ''}, ${newPassword || ''}, 'pending')
    `;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

// GET: 查自己的反馈历史
export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sql = neon(process.env.DATABASE_URL || '');

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10), 200);

  try {
    const rows = await sql`
      SELECT id, link_id, resource_id, source, reason, comment, new_password, status, admin_note, handled_at, created_at
      FROM xx_link_feedback
      WHERE user_id = ${auth.userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    ` as any[];
    return NextResponse.json({ ok: true, items: rows, total: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
