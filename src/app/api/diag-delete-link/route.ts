// 2026-07-17: diag - 直接 SQL 测 DELETE 逻辑, 不走 self-fetch
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sql = neon(process.env.DATABASE_URL || '');
  const r: any = {};

  // 1. 拿样本
  try {
    const sample = await sql`SELECT id, resource_id, source FROM xx_resource_links WHERE status = 'active' ORDER BY resource_id DESC LIMIT 1` as any[];
    r.sample = sample[0];
  } catch (e: any) { r.sample_err = e.message; return NextResponse.json(r); }

  if (!r.sample) return NextResponse.json(r);

  // 2. 直接模拟 DELETE 逻辑
  try {
    // 软删
    const upd = await sql`UPDATE xx_resource_links SET status = 'deleted' WHERE resource_id = ${r.sample.resource_id} AND source = ${r.sample.source} RETURNING id`;
    r.deleted_link = upd[0] || null;

    // 查剩余
    const remain = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE resource_id = ${r.sample.resource_id} AND status = 'active'`;
    r.remain = remain[0]?.cnt;

    // 恢复 (rollback for next test)
    await sql`UPDATE xx_resource_links SET status = 'active' WHERE id = ${r.sample.id}`;
    r.restored = true;

    return NextResponse.json(r);
  } catch (e: any) {
    r.err = e.message;
    return NextResponse.json(r);
  }
}
