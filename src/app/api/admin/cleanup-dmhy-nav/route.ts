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

// 用单 domain 简化 (dmhy 覆盖 100%, 123,955 条全部命中)
// 跟 dedup-links 一样, 用 ILIKE '%dmhy%' 跑
// 后续如果要扩展其他导航站, 再加 endpoint

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== KEY) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const action = req.nextUrl.searchParams.get('action') || 'stats';
  const r: any = { action };

  if (action === 'stats') {
    // 1. 主表 + link 含 dmhy 的总数
    try {
      const main = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%'`;
      r.main_count_dmhy = main[0]?.cnt;
    } catch (e: any) { r.main_err = e.message; }

    // 2. 副表 sort=1 数
    try {
      const sub1 = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE source = '115' AND sort = 1 AND url ILIKE '%dmhy%'`;
      r.sub_count_sort1 = sub1[0]?.cnt;
    } catch (e: any) { r.sub1_err = e.message; }

    // 3. 副表所有 sort
    try {
      const subAll = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE source = '115' AND url ILIKE '%dmhy%'`;
      r.sub_count_dmhy_all = subAll[0]?.cnt;
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

    // 6. sample 5 条
    try {
      const sample = await sql`
        SELECT id, name, link, category, created_at
        FROM xx_resources
        WHERE source = '115' AND link ILIKE '%dmhy%'
        ORDER BY id ASC
        LIMIT 5
      `;
      r.first_5 = sample;
    } catch (e: any) { r.sample_err = e.message; }

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
      const ids = toDel.map(x => x.id);
      deletedIds = ids;

      if (ids.length === 0) {
        return NextResponse.json({ action, before: beforeCnt, deleted: 0, note: 'no more' });
      }

      // 2. 并发硬删: 先副表, 再主表 (FK CASCADE 会自动处理, 但显式更稳)
      const CHUNK = 50;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        await Promise.all(slice.map(async (id) => {
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
