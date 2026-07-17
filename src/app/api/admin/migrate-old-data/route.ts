// 2026-07-17: 老数据迁移端点 (一次性)
// 跑法: GET /api/admin/migrate-old-data?fromId=0&limit=1000
// 业务规则 (2026-07-17):
//   - 把 xx_resources 老 link/link_code/source 入副表 xx_resource_links
//   - 不动 xx_resources 主表 (兼容老查询)
//   - sort 按 SOURCE_SORT 算
//   - access_level 跟资源一致 (zezhe=basic, 其他=vip)
// 重跑安全: ON CONFLICT (resource_id, source) DO NOTHING
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOURCE_SORT: Record<string, number> = {
  '115': 1, 'baidu': 2, 'quark': 3, 'aliyun': 4, 'xunlei': 5,
  '123': 6, 'uc': 7, 'tianyi': 8, 'yidong': 9, 'magnet': 10,
  'ed2k': 10, 'telegra_ph': 99, 'other': 99,
};

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const fromId = parseInt(req.nextUrl.searchParams.get('fromId') || '0', 10);
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '1000', 10), 2000);
  const sql = neon(process.env.DATABASE_URL || '');

  // 取一批
  const rows = await sql`
    SELECT id, link, link_code, source, import_channel, access_level
    FROM xx_resources
    WHERE status = 'active' AND link IS NOT NULL AND link != '' AND id > ${fromId}
    ORDER BY id ASC
    LIMIT ${limit}
  ` as any[];

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, lastId: fromId, hasMore: false, done: true });
  }

  // 准备批量 INSERT — 单 SQL 多值, 避免循环单条 (Neon HTTP 每次 100-300ms)
  // 分小组: 每 100 条一组
  const GROUP = 100;
  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];
  let lastId = fromId;

  for (let i = 0; i < rows.length; i += GROUP) {
    const chunk = rows.slice(i, i + GROUP);
    const values: any[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const r of chunk) {
      lastId = r.id;
      const source = r.source || 'other';
      const sort = SOURCE_SORT[source] ?? 99;
      const accessLevel = (r.import_channel === 'zezemom_excel') ? 'basic' : (r.access_level || 'vip');
      placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
      values.push(r.id, source, r.link, r.link_code || '', sort, 'active', accessLevel);
    }
    try {
      const sqlText = `
        INSERT INTO xx_resource_links (resource_id, source, url, password, sort, status, access_level)
        VALUES ${placeholders.join(',')}
        ON CONFLICT (resource_id, source) DO NOTHING
      `;
      await (sql as any).query(sqlText, values);
      inserted += chunk.length;
    } catch (e: any) {
      failed += chunk.length;
      if (errors.length < 5) errors.push(`batch ${i}-${i+chunk.length}: ${e.message?.slice(0, 200)}`);
    }
  }

  // 全局进度
  const totalRes = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active' AND link IS NOT NULL AND link != ''`;
  const doneRes = await sql`SELECT COUNT(DISTINCT resource_id)::int as cnt FROM xx_resource_links`;
  const total = totalRes[0]?.cnt || 0;
  const done = doneRes[0]?.cnt || 0;
  const hasMore = rows.length === limit;

  return NextResponse.json({
    ok: true,
    processed: inserted,
    failed,
    lastId,
    hasMore,
    progress: { total, done, pct: ((done / total) * 100).toFixed(2) },
    errors: errors.length > 0 ? errors : undefined,
  });
}
