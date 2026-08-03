// 2026-08-03: P6.2 admin pending 拒绝审核
//   - POST /api/admin/pending/[id]/reject
//   - body: { reason?: string }
//   - 流程: UPDATE xx_pending_resources status='rejected' + reviewed_at + reviewed_by + rejection_reason

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const pendingId = parseInt(params.id);
  if (!pendingId) return NextResponse.json({ error: 'id 错误' }, { status: 400 });

  try {
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || '';

    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 读 pending
    const pendingRows = await sql`SELECT id, status FROM xx_pending_resources WHERE id = ${pendingId}::int`;
    if (pendingRows.length === 0) {
      return NextResponse.json({ error: '找不到该 pending 资源' }, { status: 404 });
    }
    if (pendingRows[0].status !== 'pending') {
      return NextResponse.json({ error: `该资源已 ${pendingRows[0].status}，不能重复操作` }, { status: 400 });
    }

    await sql`
      UPDATE xx_pending_resources
      SET status = 'rejected', reviewed_at = NOW(), reviewed_by = ${a.userId}, rejection_reason = ${reason}
      WHERE id = ${pendingId}::int
    `;

    return NextResponse.json({ success: true, message: '已拒绝' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
