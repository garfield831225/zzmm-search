// 2026-07-17: 临时 diag 找多链接资源示例
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const r: any = {};

  // 1. 找同 resource_id 有 ≥3 个 source 的资源 (多网盘)
  try {
    const multi = await sql`
      SELECT resource_id, COUNT(DISTINCT source) as cnt,
             array_agg(DISTINCT source) as sources,
             array_agg(DISTINCT status) as statuses
      FROM xx_resource_links
      GROUP BY resource_id
      HAVING COUNT(DISTINCT source) >= 3
      ORDER BY cnt DESC
      LIMIT 10
    `;
    r.multi_3plus = multi;
  } catch (e: any) { r.multi_err = e.message; }

  // 2. 找具体一个多网盘资源的详情
  try {
    const one = await sql`
      SELECT r.id, r.name, r.category, r.source, r.import_channel
      FROM xx_resources r
      JOIN (
        SELECT resource_id, COUNT(DISTINCT source) as cnt FROM xx_resource_links
        GROUP BY resource_id HAVING COUNT(DISTINCT source) >= 3 LIMIT 1
      ) m ON r.id = m.resource_id
    `;
    if (one[0]) {
      const links = await sql`SELECT source, url, password, sort, access_level FROM xx_resource_links WHERE resource_id = ${one[0].id} ORDER BY sort, id`;
      r.example = { resource: one[0], links };
    }
  } catch (e: any) { r.example_err = e.message; }

  // 3. 总统计
  try {
    const stats = await sql`
      SELECT COUNT(*)::int as total_resources,
             COUNT(DISTINCT resource_id)::int as resources_with_links,
             COUNT(DISTINCT resource_id) FILTER (WHERE link_count >= 2)::int as resources_with_2plus,
             COUNT(DISTINCT resource_id) FILTER (WHERE link_count >= 3)::int as resources_with_3plus
      FROM (
        SELECT resource_id, COUNT(*) as link_count
        FROM xx_resource_links
        GROUP BY resource_id
      ) m
    `;
    r.stats = stats[0];
  } catch (e: any) { r.stats_err = e.message; }

  return NextResponse.json(r);
}
