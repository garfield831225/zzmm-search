// 2026-07-18: 链接去重 - 按 url 分组, 保留 updated_at/created_at 最新的, 软删其他
// 业务规则 (用户 2026-07-18 拍板):
//   - 同一 url 出现在多个 resource_id, 保留日期最近的 link
//   - 软删其他 (status='deleted'), 不删资源
//   - 重跑安全 (ON CONFLICT DO NOTHING 风格的 check)
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
    // 1. 重复 url 统计 (全部)
    try {
      const dupCount = await sql`
        WITH dup AS (
          SELECT url, COUNT(*) as cnt
          FROM xx_resource_links
          WHERE status = 'active' AND url IS NOT NULL AND url != ''
          GROUP BY url
          HAVING COUNT(*) > 1
        )
        SELECT COUNT(*)::int as dup_groups, COALESCE(SUM(cnt), 0)::int as total_dup_links,
               COALESCE(SUM(cnt - 1), 0)::int as removable
        FROM dup
      `;
      r.duplicate_stats = dupCount[0];
    } catch (e: any) { r.stats_err = e.message; }

    // 1b. 真资源链接重复 (排除 TG 频道主页 / 导航站)
    try {
      const realDup = await sql`
        WITH dup AS (
          SELECT url, COUNT(*) as cnt
          FROM xx_resource_links
          WHERE status = 'active' AND url IS NOT NULL AND url != ''
            AND source IN ('115', 'baidu', 'quark', 'aliyun', 'xunlei', '123', 'uc', 'tianyi', 'yidong', 'magnet', 'ed2k')
          GROUP BY url
          HAVING COUNT(*) > 1
        )
        SELECT COUNT(*)::int as dup_groups, COALESCE(SUM(cnt), 0)::int as total_dup_links,
               COALESCE(SUM(cnt - 1), 0)::int as removable
        FROM dup
      `;
      r.real_dup_stats = realDup[0];
    } catch (e: any) { r.real_dup_err = e.message; }

    // 2. top 10 重复示例
    try {
      const top = await sql`
        SELECT url, source, COUNT(*)::int as cnt,
               array_agg(DISTINCT resource_id) as sample_resources
        FROM xx_resource_links
        WHERE status = 'active' AND url IS NOT NULL AND url != ''
        GROUP BY url, source
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 10
      `;
      r.dup_samples = top;
    } catch (e: any) { r.samples_err = e.message; }

    // 2b. top 10 真资源重复
    try {
      const realTop = await sql`
        SELECT url, source, COUNT(*)::int as cnt,
               array_agg(DISTINCT resource_id) as sample_resources
        FROM xx_resource_links
        WHERE status = 'active' AND url IS NOT NULL AND url != ''
          AND source IN ('115', 'baidu', 'quark', 'aliyun', 'xunlei', '123', 'uc', 'tianyi', 'yidong', 'magnet', 'ed2k')
        GROUP BY url, source
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 10
      `;
      r.real_dup_samples = realTop;
    } catch (e: any) { r.real_dup_samples_err = e.message; }

    return NextResponse.json(r);
  }

  if (action === 'run') {
    // 跑去重 - 支持 only_real=true 过滤真资源链接
    // 分批: 找重复 url 一次取一批, UPDATE 一次, 循环到 hasMore
    const onlyReal = req.nextUrl.searchParams.get('only_real') === 'true';
    const fromUrl = req.nextUrl.searchParams.get('fromUrl') || '';
    const batchLimit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '1000', 10), 5000);

    try {
      const startTime = Date.now();

      const beforeRes = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE status = 'active'`;
      const before = beforeRes[0]?.cnt || 0;

      const sourceFilter = onlyReal
        ? sql`AND source IN ('115', 'baidu', 'quark', 'aliyun', 'xunlei', '123', 'uc', 'tianyi', 'yidong', 'magnet', 'ed2k')`
        : sql``;

      // 1. 找一批重复 url
      const dupBatch = await sql`
        SELECT url, COUNT(*)::int as cnt
        FROM xx_resource_links
        WHERE status = 'active' AND url IS NOT NULL AND url != '' ${sourceFilter}
          AND url > ${fromUrl}
        GROUP BY url
        HAVING COUNT(*) > 1
        ORDER BY url
        LIMIT ${batchLimit}
      ` as any[];

      if (dupBatch.length === 0) {
        const afterRes = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE status = 'active'`;
        return NextResponse.json({ ok: true, done: true, before, after: afterRes[0]?.cnt, deleted_total: r.deleted_total || 0, mode: onlyReal ? 'only_real' : 'all' });
      }

      // 2. 对每 url 找最新 id (KEEP), 其他 UPDATE deleted
      let batchDeleted = 0;
      let lastUrl = fromUrl;
      for (const dup of dupBatch) {
        lastUrl = dup.url;
        // 找这条 url 的所有 id, 按 updated_at DESC, id DESC 排序, 保留第一条
        const ids = await sql`
          SELECT id FROM xx_resource_links
          WHERE url = ${dup.url} AND status = 'active'
          ORDER BY updated_at DESC, id DESC
        ` as any[];

        if (ids.length > 1) {
          const toDelete = ids.slice(1).map((r: any) => r.id);
          // 批量 UPDATE
          for (let i = 0; i < toDelete.length; i += 100) {
            const sub = toDelete.slice(i, i + 100);
            await sql`
              UPDATE xx_resource_links
              SET status = 'deleted'
              WHERE id = ANY(${sub}::int[])
            `;
            batchDeleted += sub.length;
          }
        }
      }

      const afterRes = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE status = 'active'`;
      const after = afterRes[0]?.cnt || 0;

      return NextResponse.json({
        ok: true,
        done: false,
        hasMore: dupBatch.length === batchLimit,
        lastUrl,
        mode: onlyReal ? 'only_real' : 'all',
        before,
        after,
        batch_deleted: batchDeleted,
        nextUrl: `${req.nextUrl.origin}/api/admin/dedup-links?key=zzmm-batch-test&action=run&fromUrl=${encodeURIComponent(lastUrl)}&limit=${batchLimit}${onlyReal ? '&only_real=true' : ''}`,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message?.slice(0, 300) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'unknown action (use ?action=stats or run)' });
}
