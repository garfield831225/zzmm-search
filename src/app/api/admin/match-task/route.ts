import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function getSql() { return neon(process.env.DATABASE_URL || ''); }

// GET:查任务状态
export async function GET(req: NextRequest) {
  const sql = getSql();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    const rows = await sql`SELECT * FROM xx_match_tasks WHERE id = ${id}`.catch(() => []) as any[];
    return NextResponse.json({ task: rows[0] || null });
  }

  const rows = await sql`SELECT * FROM xx_match_tasks ORDER BY id DESC LIMIT 1`.catch(() => []) as any[];
  return NextResponse.json({ task: rows[0] || null });
}

// POST: 触发新任务
export async function POST(req: NextRequest) {
  const sql = getSql();
  try {
    const active = await sql`SELECT id FROM xx_match_tasks WHERE status IN ('pending', 'running') LIMIT 1`.catch(() => []) as any[];
    if (active.length > 0) {
      return NextResponse.json({ error: '已有任务在跑', taskId: active[0].id }, { status: 409 });
    }

    const pending = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE tmdb_id IS NULL`.catch(() => [{cnt: 0}]) as any[];
    const total = pending[0]?.cnt || 0;

    const rows = await sql`
      INSERT INTO xx_match_tasks (status, total, matched, nomatch, "offset", batch_size, error_msg, created_at, updated_at)
      VALUES ('pending', ${total}, 0, 0, 0, 200, '', NOW(), NOW())
      RETURNING id, status, total, matched, nomatch
    `.catch(() => []) as any[];

    return NextResponse.json({ task: rows[0] || null, total });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT: 更新任务
export async function PUT(req: NextRequest) {
  const sql = getSql();
  const body = await req.json().catch(() => ({}));
  const { id, status, matched, nomatch, offset, error_msg } = body;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  try {
    const rows = await sql`
      UPDATE xx_match_tasks
      SET status = ${status || 'running'},
          matched = COALESCE(${matched}, matched),
          nomatch = COALESCE(${nomatch}, nomatch),
          "offset" = COALESCE(${offset}, "offset"),
          error_msg = ${error_msg || ''},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `.catch(() => []) as any[];
    return NextResponse.json({ task: rows[0] || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}