// 2026-07-18: diag - 查 xx_resources schema + 看 (link, name) 重复
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const r: any = {};
  const action = req.nextUrl.searchParams.get('action') || 'inspect';

  if (action === 'inspect') {
    // 查约束 + 重复
    try {
      const cons = await sql`SELECT conname, contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'xx_resources'::regclass`;
      r.constraints = cons;
    } catch (e: any) { r.cons_err = e.message; }

    // 查 (link, name) 重复
    try {
      const dups = await sql`
        SELECT link, name, COUNT(*)::int as cnt
        FROM xx_resources
        WHERE link IS NOT NULL AND link != ''
        GROUP BY link, name
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 10
      `;
      r.duplicates = dups;
    } catch (e: any) { r.dup_err = e.message; }

    // 总 (link, name) 重复行数
    try {
      const totalDup = await sql`
        WITH dup AS (
          SELECT link, name FROM xx_resources
          WHERE link IS NOT NULL AND link != ''
          GROUP BY link, name HAVING COUNT(*) > 1
        )
        SELECT COUNT(*)::int as dup_groups, SUM(c.cnt - 1)::int as extra_rows
        FROM dup
        JOIN (SELECT link, name, COUNT(*) as cnt FROM xx_resources WHERE link IS NOT NULL AND link != '' GROUP BY link, name) c
        USING (link, name)
      `;
      r.duplicate_summary = totalDup[0];
    } catch (e: any) { r.sum_err = e.message; }

    return NextResponse.json(r);
  }

  if (action === 'add_unique') {
    // 加 (link, name) UNIQUE 约束
    try {
      // 先检查重复, 有重复得清理
      const dup = await sql`SELECT link, name, COUNT(*) as cnt FROM xx_resources WHERE link IS NOT NULL AND link != '' GROUP BY link, name HAVING COUNT(*) > 1 LIMIT 1`;
      if (dup[0]) {
        return NextResponse.json({ ok: false, error: '有重复, 先清理', sample: dup[0] }, { status: 400 });
      }
      await sql`ALTER TABLE xx_resources ADD CONSTRAINT xx_resources_link_name_unique UNIQUE (link, name)`;
      return NextResponse.json({ ok: true, msg: 'UNIQUE (link, name) 已加' });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message?.slice(0, 200) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'unknown action' });
}

