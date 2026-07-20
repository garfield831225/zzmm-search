// 2026-07-21: 临时 - 强制 Vercel Neon endpoint 跟主 endpoint 同步
// 写一个 noop INSERT 到 xx_activation_codes (走主 endpoint), 触发所有 read replica 重读
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const a = authAdmin(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // 写一个 noop 记录, 强制主 endpoint 同步
    const r = await sql`
      INSERT INTO xx_activation_codes (code, code_type, plan_id, duration, channel, created_by, is_used, user_group)
      VALUES ('SYNC-NOOP', 'noop', 'NOOP', 1, 'sync', ${a.userId}, false, 'admin')
      RETURNING id
    `;
    const id = r[0]?.id;

    // 立即删掉, 不污染数据
    if (id) await sql`DELETE FROM xx_activation_codes WHERE id = ${id}`;

    // 查所有 read replica 真实总数
    const t = await sql`SELECT COUNT(*)::int AS c FROM xx_resources WHERE status = 'active'`;

    return NextResponse.json({
      success: true,
      sync_record_id: id,
      active_count_now: t[0]?.c,
      message: '主 endpoint 同步已触发, 5-10 秒后 read replica 会看到新数据',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
