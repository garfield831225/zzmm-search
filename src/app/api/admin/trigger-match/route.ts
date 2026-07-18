// 2026-07-18: 触发 match-task 端点 (强制 INSERT pending task, 绕过 read replica lag)
// 鉴权: 用 zzmm-batch-test key (跟其他 diag 端点一样)
// 端点:
//   POST /api/admin/trigger-match?key=zzmm-batch-test
//   body: { total?: number }  默认 50000
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const KEY = 'zzmm-batch-test';

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') || '';
  if (key !== KEY) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sql = neon(process.env.DATABASE_URL || '');
  // 既支持 JSON body, 也支持 query param
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const total = body?.total || parseInt(req.nextUrl.searchParams.get('total') || '50000');

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
