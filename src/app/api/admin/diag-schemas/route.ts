// 2026-07-20 临时: 查 xx_activation_codes 表结构
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');
  const r = await sql`SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'xx_activation_codes'
    ORDER BY ordinal_position`;
  return NextResponse.json({ columns: r });
}
