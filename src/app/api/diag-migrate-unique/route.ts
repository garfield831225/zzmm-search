// 2026-07-18: 一次性 - 改 UNIQUE 约束 (resource_id, source) → (resource_id, sort)
// 业务规则: 同一资源 sort=1 必须是主链接, 排序唯一性
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const action = req.nextUrl.searchParams.get('action') || 'check';
  const r: any = {};

  if (action === 'check') {
    // 查当前约束
    try {
      const cons = await sql`
        SELECT conname, contype, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conrelid = 'xx_resource_links'::regclass AND contype = 'u'
      `;
      r.constraints = cons;
    } catch (e: any) { r.cons_err = e.message; }
    return NextResponse.json(r);
  }

  if (action === 'migrate') {
    // 1. 删旧 UNIQUE
    // 2. 加新 UNIQUE (resource_id, sort)
    try {
      await sql`ALTER TABLE xx_resource_links DROP CONSTRAINT IF EXISTS xx_resource_links_unique`;
      r.drop_old = 'ok';
    } catch (e: any) {
      r.drop_err = e.message?.slice(0, 200);
    }

    try {
      await sql`ALTER TABLE xx_resource_links ADD CONSTRAINT xx_resource_links_resource_id_sort_unique UNIQUE (resource_id, sort)`;
      r.add_new = 'ok';
    } catch (e: any) {
      r.add_err = e.message?.slice(0, 200);
    }

    // 验证
    try {
      const cons = await sql`
        SELECT conname, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conrelid = 'xx_resource_links'::regclass AND contype = 'u'
      `;
      r.constraints = cons;
    } catch (e: any) { r.verify_err = e.message; }

    return NextResponse.json(r);
  }

  return NextResponse.json({ error: 'unknown action' });
}
