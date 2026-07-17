// 极简测试: 插一条 305635 试试
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const r: any = {};

  // 0. 看 305635 是否存在
  try {
    const c = await sql`SELECT id, source, import_channel, link FROM xx_resources WHERE id = 305635`;
    r.resource = c;
  } catch (e: any) { r.resource_err = e.message; }

  // 1. 清理之前
  try { await sql`DELETE FROM xx_resource_links WHERE resource_id = 305635`; r.clean = 'ok'; } catch (e: any) { r.clean_err = e.message; }

  // 2. 查清理后
  try {
    const c = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE resource_id = 305635`;
    r.before = c[0]?.cnt;
  } catch (e: any) { r.before_err = e.message; }

  // 3. 单条 INSERT
  try {
    const ir = await sql`INSERT INTO xx_resource_links (resource_id, source, url, password, sort, status, access_level) VALUES (${305635}, ${'115'}, ${'test_url'}, ${''}, ${1}, ${'active'}, ${'basic'}) ON CONFLICT (resource_id, source) DO NOTHING RETURNING id`;
    r.insert_result = ir;
    r.insert_type = typeof ir;
    r.insert_len = Array.isArray(ir) ? ir.length : 'not array';
  } catch (e: any) { r.insert_err = e.message; }

  // 4. 查插入后
  try {
    const c = await sql`SELECT * FROM xx_resource_links WHERE resource_id = 305635`;
    r.after = c;
  } catch (e: any) { r.after_err = e.message; }

  // 5. 总数 (用 INSERT 端点同 sql, 避免 read replica lag)
  try {
    const c = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links`;
    r.total_count = c[0]?.cnt;
  } catch (e: any) { r.total_count_err = e.message; }

  return NextResponse.json(r);
}
