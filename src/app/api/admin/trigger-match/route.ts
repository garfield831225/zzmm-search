// 2026-07-18: Admin 触发 match-task 端点
// 业务规则: 强制 INSERT pending task (走 Vercel Neon endpoint, 避开 read replica lag)
// 端点:
//   POST /api/admin/trigger-match
//   body: { total?: number }  默认 50000
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

function authAdmin(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'cLWhs2015') as any;
    if (String(payload.user_group || payload.group || '').toLowerCase() !== 'admin') {
      return { error: '需要 admin', status: 403 };
    }
    return { userId: String(payload.id) };
  } catch {
    return { error: 'token 无效', status: 401 };
  }
}

export async function POST(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const body = await req.json().catch(() => ({}));
  const total = body?.total || 50000;

  try {
    // 1. 检查现有 task
    const existing = await sql`SELECT id, status FROM xx_match_tasks WHERE status IN ('pending', 'running') ORDER BY id DESC LIMIT 1` as any[];
    if (existing[0]) {
      return NextResponse.json({
        ok: true,
        message: '已有 pending/running task',
        task: existing[0],
        action: 'skip_insert',
      });
    }

    // 2. INSERT pending task
    const inserted = await sql`
      INSERT INTO xx_match_tasks (status, total, matched, nomatch, "offset", batch_size, created_at, updated_at)
      VALUES ('pending', ${total}, 0, 0, 0, 200, NOW(), NOW())
      RETURNING id
    ` as any[];

    return NextResponse.json({
      ok: true,
      message: 'pending task 已创建, 现在可以调 /api/cron/match-task',
      taskId: inserted[0]?.id,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
