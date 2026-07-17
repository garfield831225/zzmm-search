// 调试: 测试 UNNEST 在 Neon serverless v3 怎么用
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const results: any = {};

  // Test 1: 单值 array 插入单条
  try {
    const r1 = await sql`INSERT INTO xx_resource_links (resource_id, source, url) VALUES (${1}, ${'test1'}, ${'url1'}) ON CONFLICT (resource_id, source) DO NOTHING RETURNING id`;
    results.test1_single = (r1 as any[]).length;
  } catch (e: any) { results.test1_error = e.message?.slice(0, 200); }

  // Test 2: 清理 test1
  try { await sql`DELETE FROM xx_resource_links WHERE source = 'test1' OR source = 'test2' OR source = 'test3'`; } catch {}

  // Test 3: UNNEST 3 行
  try {
    const ids = [1, 2, 3];
    const sources = ['test1', 'test2', 'test3'];
    const urls = ['u1', 'u2', 'u3'];
    const r3 = await sql`
      INSERT INTO xx_resource_links (resource_id, source, url, password, sort, status, access_level)
      SELECT * FROM UNNEST(
        ${ids}::int[],
        ${sources}::text[],
        ${urls}::text[],
        ${['', '', '']}::text[],
        ${[1, 2, 3]}::int[],
        ${['active', 'active', 'active']}::text[],
        ${['vip', 'vip', 'vip']}::text[]
      )
      ON CONFLICT (resource_id, source) DO NOTHING
      RETURNING id, source
    `;
    results.test3_unnest_returned = r3;
  } catch (e: any) {
    results.test3_error = e.message?.slice(0, 300);
  }

  // Test 4: 查总数
  try {
    const c = await sql`SELECT COUNT(*)::int as cnt, source FROM xx_resource_links WHERE source IN ('test1', 'test2', 'test3') GROUP BY source`;
    results.test4_actual_count = c;
  } catch (e: any) { results.test4_error = e.message?.slice(0, 200); }

  // 清理
  try { await sql`DELETE FROM xx_resource_links WHERE source IN ('test1', 'test2', 'test3')`; } catch {}

  return NextResponse.json(results);
}
