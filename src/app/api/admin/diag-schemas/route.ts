// 2026-07-20 临时: 查 code/activate/invite 相关表名
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');
  const r = await sql`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND (table_name LIKE '%code%' OR table_name LIKE '%activ%' OR table_name LIKE '%invite%' OR table_name LIKE '%vip%')
    ORDER BY table_name`;
  return NextResponse.json({ tables: r.map((x: any) => x.table_name) });
}
