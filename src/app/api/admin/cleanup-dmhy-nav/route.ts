// 2026-07-18: 清理 dmhy 导航站脏数据
// 业务规则 (用户 2026-07-18 拍板):
//   "导航站不是网盘链接的直接删"
// 触发原因: 早期 tg-json 路由用 `source === 'other' ? '115' : source` 兜底,
//   把 dmhy/anoneko/share.dmhy.org 等导航站 URL 当 115 入库了 123,955 条
//   现在按业务规则清理
//
// 端点:
//   ?key=&action=stats        - 看数量 + 分布
//   ?key=&action=sample&n=20  - 抽 20 条看实际内容
//   ?key=&action=delete&limit=N&offset=0 - 分批硬删 N 条
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = 'zzmm-batch-test';

// 导航站黑名单 URL 模式 (dmhy/anoneko/popgo/bangumi/acgnx/nyaa/acg.rip 等 BT 站分享页)
const NAV_DOMAINS = [
  '%dmhy.org%',
  '%anoneko.com%',
  '%share.popgo.org%',
  '%bangumi.moe%',
  '%acgnx.se%',
  '%nyaa.si%',
  '%acg.rip%',
  '%mikanani.me%',
  '%dmgapp.com%',
  '%animebytes.tv%',
  '%share.acgnx.se%',
  '%ani.gamer.com.tw%',
  '%gamer.com.tw%',
];

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== KEY) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const action = req.nextUrl.searchParams.get('action') || 'stats';
  const r: any = { action };

  if (action === 'stats') {
    // 1. 主表 + link 含导航站的总数
    try {
      const navFilter = NAV_DOMAINS.map((_, i) => `(r.link ILIKE $${i + 1})`).join(' OR ');
      const mainCount = await (sql as any).query(
        `SELECT COUNT(*)::int as cnt FROM xx_resources r WHERE source = '115' AND (${navFilter})`,
        NAV_DOMAINS
      );
      r.main_count_dmhy = mainCount[0]?.cnt;
    } catch (e: any) { r.main_err = e.message; }

    // 2. 主表 + 副表都含导航站的总资源数 (delete 候选)
    try {
      const navFilter = NAV_DOMAINS.map((_, i) => `(r.link ILIKE $${i + 1})`).join(' OR ');
      const subFilter = NAV_DOMAINS.map((_, i) => `(l.url ILIKE $${NAV_DOMAINS.length + i + 1})`).join(' OR ');
      const fullCount = await (sql as any).query(
        `SELECT COUNT(DISTINCT r.id)::int as cnt
         FROM xx_resources r
         LEFT JOIN xx_resource_links l ON l.resource_id = r.id
         WHERE r.source = '115' AND (${navFilter})`,
        NAV_DOMAINS
      );
      r.delete_candidate_count = fullCount[0]?.cnt;
    } catch (e: any) { r.full_err = e.message; }

    // 3. 副表含导航站的总数
    try {
      const navFilter = NAV_DOMAINS.map((_, i) => `(url ILIKE $${i + 1})`).join(' OR ');
      const subCount = await (sql as any).query(
        `SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE source = '115' AND (${navFilter})`,
        NAV_DOMAINS
      );
      r.sub_count_dmhy = subCount[0]?.cnt;
    } catch (e: any) { r.sub_err = e.message; }

    // 4. 时间分布
    try {
      const timeDist = await sql`
        SELECT
          CASE
            WHEN created_at > NOW() - INTERVAL '6 hours' THEN '0-6h'
            WHEN created_at > NOW() - INTERVAL '24 hours' THEN '6-24h'
            WHEN created_at > NOW() - INTERVAL '7 days' THEN '1-7d'
            ELSE '7d+'
          END as time_bucket,
          COUNT(*)::int as cnt
        FROM xx_resources
        WHERE source = '115' AND link ILIKE '%dmhy%'
        GROUP BY time_bucket
        ORDER BY time_bucket
      `;
      r.time_dist = timeDist;
    } catch (e: any) { r.time_err = e.message; }

    // 5. import_channel 分布
    try {
      const chanDist = await sql`
        SELECT import_channel, COUNT(*)::int as cnt
        FROM xx_resources
        WHERE source = '115' AND link ILIKE '%dmhy%'
        GROUP BY import_channel
      `;
      r.import_channel_dist = chanDist;
    } catch (e: any) { r.chan_err = e.message; }

    return NextResponse.json(r);
  }

  if (action === 'sample') {
    const n = Math.min(parseInt(req.nextUrl.searchParams.get('n') || '20'), 100);
    try {
      const sample = await sql`
        SELECT id, name, link, source, category, import_channel, created_at
        FROM xx_resources
        WHERE source = '115' AND link ILIKE '%dmhy%'
        ORDER BY id DESC
        LIMIT ${n}
      `;
      r.samples = sample;
    } catch (e: any) { r.err = e.message; }
    return NextResponse.json(r);
  }

  if (action === 'delete') {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '1000'), 5000);
    const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0');

    // 1. 取要删的 id 范围 (按 id 升序分批)
    let beforeCnt = 0;
    let afterCnt = 0;
    let deletedIds: number[] = [];
    try {
      const before = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%'`;
      beforeCnt = before[0]?.cnt || 0;

      // 取要删的 ids
      const toDel = await sql`
        SELECT id FROM xx_resources
        WHERE source = '115' AND link ILIKE '%dmhy%'
        ORDER BY id ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
      const ids = toDel.map((x: any) => x.id);
      deletedIds = ids;

      if (ids.length === 0) {
        return NextResponse.json({ action, before: beforeCnt, deleted: 0, note: 'no more' });
      }

      // 2. 并发硬删: 先副表, 再主表 (FK CASCADE 会自动处理, 但显式更稳)
      const CHUNK = 50;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        await Promise.all(slice.map(async (id: number) => {
          // 显式删副表 (虽然有 CASCADE, 但因为不返 id 列表, 走显式更明确)
          try { await sql`DELETE FROM xx_resource_links WHERE resource_id = ${id}`; } catch {}
          try { await sql`DELETE FROM xx_resources WHERE id = ${id}`; } catch {}
        }));
      }

      const after = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%'`;
      afterCnt = after[0]?.cnt || 0;
    } catch (e: any) {
      return NextResponse.json({ action, error: e.message }, { status: 500 });
    }

    return NextResponse.json({
      action,
      limit, offset,
      before: beforeCnt,
      after: afterCnt,
      deleted: beforeCnt - afterCnt,
      deleted_ids_sample: deletedIds.slice(0, 10),
    });
  }

  return NextResponse.json({ error: 'unknown action, use stats|sample|delete' }, { status: 400 });
}
