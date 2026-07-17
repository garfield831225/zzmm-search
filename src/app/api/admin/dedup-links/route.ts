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
    // 只查 metadata, 不写库
    // 返 1 个 url + 它的所有 id, 本地决定 KEEP 哪个, 然后 POST process_batch 处理
    const onlyReal = req.nextUrl.searchParams.get('only_real') === 'true';
    const fromUrl = req.nextUrl.searchParams.get('fromUrl') || '';
    const batchLimit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '5', 10), 50);

    try {
      const sourceFilter = onlyReal
        ? "AND source IN ('115', 'baidu', 'quark', 'aliyun', 'xunlei', '123', 'uc', 'tianyi', 'yidong', 'magnet', 'ed2k')"
        : "";

      // 1. 找一批重复 url
      const dupUrls = await sql(
        `SELECT url, COUNT(*)::int as cnt
         FROM xx_resource_links
         WHERE status = 'active' AND url IS NOT NULL AND url != '' ${sourceFilter}
           AND url > $1
         GROUP BY url
         HAVING COUNT(*) > 1
         ORDER BY url
         LIMIT $2`
      , [fromUrl, batchLimit]) as any[];

      if (dupUrls.length === 0) {
        return NextResponse.json({ ok: true, done: true, mode: onlyReal ? 'only_real' : 'all', deleted: 0 });
      }

      // 2. 找每 url 的所有 id (按 updated_at DESC), 让本地决定 KEEP/DEL
      const result: any[] = [];
      for (const dup of dupUrls) {
        const ids = await sql`SELECT id, updated_at FROM xx_resource_links WHERE url = ${dup.url} AND status = 'active' ORDER BY updated_at DESC, id DESC` as any[];
        result.push({ url: dup.url, cnt: dup.cnt, links: ids });
      }

      return NextResponse.json({
        ok: true,
        done: false,
        mode: onlyReal ? 'only_real' : 'all',
        batch: result,
        nextUrl: dupUrls.length === batchLimit
          ? `${req.nextUrl.origin}/api/admin/dedup-links?key=zzmm-batch-test&action=run&fromUrl=${encodeURIComponent(dupUrls[dupUrls.length - 1].url)}&limit=${batchLimit}${onlyReal ? '&only_real=true' : ''}`
          : null,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message?.slice(0, 300) }, { status: 500 });
    }
  }

  if (action === 'process_batch') {
    // POST body: { ids: [1,2,3,...] } - 50 并发 UPDATE deleted
    let body: any = {};
    try { body = await req.json(); } catch {}
    const ids: number[] = (body.ids || []).map((n: any) => Number(n)).filter((n: any) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return NextResponse.json({ ok: false, error: '需要 ids 数组' }, { status: 400 });
    if (ids.length > 500) return NextResponse.json({ ok: false, error: '单次最多 500' }, { status: 400 });

    try {
      const CONCURRENCY = 50;
      let deleted = 0;
      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const chunk = ids.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(chunk.map(id => sql`UPDATE xx_resource_links SET status = 'deleted' WHERE id = ${id}`));
        deleted += results.filter(r => r.status === 'fulfilled').length;
      }
      return NextResponse.json({ ok: true, deleted, requested: ids.length });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message?.slice(0, 300) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'unknown action (use ?action=stats or run)' });
}
