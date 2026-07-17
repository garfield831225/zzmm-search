// 2026-07-18: 一次性 - 回填 sort=1 副表 (主表 link 入副表)
// 业务规则: 主表每条资源 link 字段是 sort=1 主链接
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const action = req.nextUrl.searchParams.get('action') || 'stats';
  const r: any = {};

  if (action === 'stats') {
    // 待回填数
    try {
      const needFill = await sql`
        SELECT COUNT(*)::int as cnt
        FROM xx_resources r
        WHERE r.status = 'active' AND r.link IS NOT NULL AND r.link != ''
          AND NOT EXISTS (
            SELECT 1 FROM xx_resource_links l
            WHERE l.resource_id = r.id AND l.sort = 1
          )
      `;
      r.need_fill = needFill[0]?.cnt;
    } catch (e: any) { r.need_err = e.message; }

    // 总数
    try {
      const total = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active' AND link IS NOT NULL AND link != ''`;
      r.total_with_link = total[0]?.cnt;
    } catch (e: any) { r.total_err = e.message; }

    try {
      const sub = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE sort = 1 AND status = 'active'`;
      r.sort1_already = sub[0]?.cnt;
    } catch (e: any) { r.sort1_err = e.message; }

    return NextResponse.json(r);
  }

  if (action === 'run') {
    // 跑一批
    const fromId = parseInt(req.nextUrl.searchParams.get('fromId') || '0', 10);
    const batchSize = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '2000', 10), 5000);

    try {
      // 用单 SQL INSERT...SELECT + ON CONFLICT DO NOTHING
      // 2000 条 1 个 SQL, Neon HTTP 应该能跑
      const startTime = Date.now();
      const upd = await sql`
        INSERT INTO xx_resource_links (resource_id, source, url, password, sort, status, access_level)
        SELECT id, source, link, COALESCE(link_code, ''), 1, 'active', 'vip'
        FROM xx_resources
        WHERE status = 'active' AND link IS NOT NULL AND link != ''
          AND id > ${fromId}
          AND NOT EXISTS (
            SELECT 1 FROM xx_resource_links l
            WHERE l.resource_id = xx_resources.id AND l.sort = 1
          )
        ORDER BY id
        LIMIT ${batchSize}
        ON CONFLICT (resource_id, sort) DO NOTHING
      ` as any[];
      const inserted = upd?.length || 0;

      // 拿 last id
      const lastIdRes = await sql`
        SELECT MAX(id) as max_id FROM xx_resource_links
        WHERE id <= (SELECT MAX(id) FROM xx_resources WHERE status = 'active' AND link IS NOT NULL AND link != '')
      `;

      const remainRes = await sql`
        SELECT COUNT(*)::int as cnt
        FROM xx_resources r
        WHERE r.status = 'active' AND r.link IS NOT NULL AND r.link != ''
          AND r.id > ${fromId}
          AND NOT EXISTS (
            SELECT 1 FROM xx_resource_links l
            WHERE l.resource_id = r.id AND l.sort = 1
          )
      `;
      const remain = remainRes[0]?.cnt || 0;

      return NextResponse.json({
        ok: true,
        batch_inserted: inserted,
        batch_duration_ms: Date.now() - startTime,
        fromId,
        nextFromId: fromId + batchSize,
        remain,
        done: remain === 0,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message?.slice(0, 300) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'unknown action' });
}
