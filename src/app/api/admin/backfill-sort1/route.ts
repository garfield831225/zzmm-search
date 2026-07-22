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
      const startTime = Date.now();

      // before: 查这批 id 范围中已存在 sort=1 的 resource_id
      const beforeRes = await sql(
        `SELECT resource_id FROM xx_resource_links
         WHERE sort = 1 AND resource_id > $1 AND resource_id <= $1 + $2`,
        [fromId, batchSize]
      );
      const existed = new Set((beforeRes || []).map((r: any) => Number(r.resource_id)));

      // INSERT (Neon serverless v3 RETURNING 不可靠, 不依赖)
      // 先看本批要处理什么
      const sample = await sql`
        SELECT id, link, source FROM xx_resources
        WHERE status = 'active' AND link IS NOT NULL AND link != ''
          AND id > ${fromId}
          AND NOT EXISTS (
            SELECT 1 FROM xx_resource_links l
            WHERE l.resource_id = xx_resources.id AND l.sort = 1
          )
        ORDER BY id
        LIMIT ${batchSize}
      ` as any[];

      if (sample.length === 0) {
        // 跳到下一个未填位置
        const next = await sql`SELECT MIN(id)::int as id FROM xx_resources WHERE status = 'active' AND link IS NOT NULL AND link != '' AND id > ${fromId} AND NOT EXISTS (SELECT 1 FROM xx_resource_links l WHERE l.resource_id = xx_resources.id AND l.sort = 1)`;
        return NextResponse.json({ ok: true, batch_inserted: 0, sample_count: 0, fromId, nextFromId: next[0]?.id || 0, done: !next[0]?.id });
      }

      // 实际入
      await sql`
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
      `;

      // after: 查 sample 范围内已存在 sort=1 的 resource_id (IN 拼字符串避免 Neon ANY 坏)
      const sampleIds = sample.map((s: any) => s.id);
      const afterRes = sampleIds.length > 0
        ? await sql(
            `SELECT resource_id FROM xx_resource_links
             WHERE sort = 1 AND resource_id IN (${sampleIds.join(',')})`
          )
        : [];
      const after = new Set((afterRes || []).map((r: any) => Number(r.resource_id)));

      // 新增 = after - before
      let inserted = 0;
      after.forEach(id => {
        if (!existed.has(id)) inserted++;
      });

      const remainRes = await sql`
        SELECT COALESCE(MAX(id), 0)::int as max_id
        FROM xx_resources
        WHERE status = 'active' AND link IS NOT NULL AND link != ''
      `;
      const maxId = remainRes[0]?.max_id || 0;

      // 找当前 fromId 之后第一个"未填"位置
      const nextMissing = await sql`
        SELECT id FROM xx_resources
        WHERE status = 'active' AND link IS NOT NULL AND link != ''
          AND id > ${fromId}
          AND NOT EXISTS (
            SELECT 1 FROM xx_resource_links l
            WHERE l.resource_id = xx_resources.id AND l.sort = 1
          )
        ORDER BY id
        LIMIT 1
      `;
      const nextFromId = nextMissing[0]?.id || (fromId + batchSize);
      const done = !nextMissing[0] || (nextMissing[0]?.id > maxId);

      return NextResponse.json({
        ok: true,
        batch_inserted: inserted,
        batch_duration_ms: Date.now() - startTime,
        fromId,
        nextFromId,
        maxId,
        done,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message?.slice(0, 300) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'unknown action' });
}
