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
        SELECT url, source, COUNT(*)::int as cnt
        FROM xx_resource_links
        WHERE status = 'active' AND url IS NOT NULL AND url != ''
        GROUP BY url
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 10
      `;
      r.dup_samples = top;
    } catch (e: any) { r.samples_err = e.message; }

    // 2b. top 10 真资源重复
    try {
      const realTop = await sql`
        SELECT url, source, COUNT(*)::int as cnt
        FROM xx_resource_links
        WHERE status = 'active' AND url IS NOT NULL AND url != ''
          AND source IN ('115', 'baidu', 'quark', 'aliyun', 'xunlei', '123', 'uc', 'tianyi', 'yidong', 'magnet', 'ed2k')
        GROUP BY url
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
    const onlyReal = req.nextUrl.searchParams.get('only_real') === 'true';

    try {
      const startTime = Date.now();

      const beforeRes = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE status = 'active'`;
      const before = beforeRes[0]?.cnt || 0;

      const sourceFilter = onlyReal
        ? sql`AND source IN ('115', 'baidu', 'quark', 'aliyun', 'xunlei', '123', 'uc', 'tianyi', 'yidong', 'magnet', 'ed2k')`
        : sql``;

      const upd = await sql`
        UPDATE xx_resource_links
        SET status = 'deleted'
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY url ORDER BY updated_at DESC, id DESC) AS rn
            FROM xx_resource_links
            WHERE status = 'active' AND url IS NOT NULL AND url != '' ${sourceFilter}
          ) t WHERE rn > 1
        )
        RETURNING id
      ` as any[];

      const deleted = upd?.length || 0;

      const afterRes = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE status = 'active'`;
      const after = afterRes[0]?.cnt || 0;

      r.ok = true;
      r.mode = onlyReal ? 'only_real' : 'all';
      r.before = before;
      r.after = after;
      r.deleted = deleted;
      r.duration_ms = Date.now() - startTime;
      return NextResponse.json(r);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message?.slice(0, 300) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'unknown action (use ?action=stats or run)' });
}
