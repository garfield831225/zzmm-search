// 2026-07-18: diag - 按 source/category 分布 + 跨 source 错配检查
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const r: any = {};

  // 1. 按 source + category 分布 (TG 资源)
  try {
    const bySrc = await sql`
      SELECT source, category, COUNT(*)::int as cnt
      FROM xx_resources
      WHERE status = 'active' AND import_channel LIKE 'tg_%'
        AND created_at > NOW() - INTERVAL '6 hours'
      GROUP BY source, category
      ORDER BY cnt DESC
      LIMIT 30
    `;
    r.source_category_dist = bySrc;
  } catch (e: any) { r.src_cat_err = e.message; }

  // 2. 按 source 总分布 (TG 资源)
  try {
    const bySrcOnly = await sql`
      SELECT source, COUNT(*)::int as cnt
      FROM xx_resources
      WHERE status = 'active' AND import_channel LIKE 'tg_%'
        AND created_at > NOW() - INTERVAL '6 hours'
      GROUP BY source
      ORDER BY cnt DESC
    `;
    r.source_dist_6h = bySrcOnly;
  } catch (e: any) { r.src_err = e.message; }

  // 3. 副表 source 分布 (TG 资源)
  try {
    const subBySrc = await sql`
      SELECT l.source, COUNT(*)::int as cnt
      FROM xx_resource_links l
      JOIN xx_resources r ON l.resource_id = r.id
      WHERE l.status = 'active' AND r.status = 'active' AND r.import_channel LIKE 'tg_%'
        AND r.created_at > NOW() - INTERVAL '6 hours'
      GROUP BY l.source
      ORDER BY cnt DESC
    `;
    r.sub_source_dist_6h = subBySrc;
  } catch (e: any) { r.sub_err = e.message; }

  // 4. 跨 source 错配 (主表 source=115 但副表全是 baidu, 找 10 个看看)
  try {
    const mismatch = await sql`
      SELECT r.id, r.name, r.source as main_source,
             l.source as link_source, l.sort
      FROM xx_resources r
      JOIN xx_resource_links l ON l.resource_id = r.id AND l.status = 'active'
      WHERE r.status = 'active' AND r.import_channel LIKE 'tg_%'
        AND r.created_at > NOW() - INTERVAL '6 hours'
        AND r.source = '115' AND l.source != '115'
      ORDER BY r.id DESC
      LIMIT 10
    `;
    r.cross_source_samples = mismatch;
  } catch (e: any) { r.mismatch_err = e.message; }

  return NextResponse.json(r);
}
