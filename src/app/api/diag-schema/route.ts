// 2026-07-18: diag - 查 xx_resources 表的 UNIQUE 约束
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const r: any = {};

  // xx_resources 所有列
  try {
    const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'xx_resources' ORDER BY ordinal_position`;
    r.xx_resources_columns = cols;
  } catch (e: any) { r.cols_err = e.message; }

  // xx_resources 索引
  try {
    const idx = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'xx_resources'`;
    r.xx_resources_indexes = idx;
  } catch (e: any) { r.idx_err = e.message; }

  // xx_resources 约束
  try {
    const cons = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'xx_resources'::regclass
    `;
    r.xx_resources_constraints = cons;
  } catch (e: any) { r.cons_err = e.message; }

  return NextResponse.json(r);
}
