// 2026-07-18: diag - 看 TG 新上传的入库情况 + TMDB 匹配
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const r: any = {};

  // 1. 总览: 各 import_channel + status 计数
  try {
    const total = await sql`
      SELECT import_channel, status, COUNT(*)::int as cnt
      FROM xx_resources
      GROUP BY import_channel, status
      ORDER BY import_channel, status
    `;
    r.overview = total;
  } catch (e: any) { r.overview_err = e.message; }

  // 2. 副表 xx_resource_links 总数
  try {
    const subTotal = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE status = 'active'`;
    r.sub_active = subTotal[0]?.cnt;
  } catch (e: any) { r.sub_err = e.message; }

  // 3. TMDB 匹配情况
  try {
    const match = await sql`
      SELECT import_channel,
             COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE tmdb_id IS NOT NULL AND tmdb_id ~ '^[0-9]+$' AND length(tmdb_id) <= 10)::int as matched,
             COUNT(*) FILTER (WHERE tmdb_id IS NULL)::int as unmatched
      FROM xx_resources
      WHERE status = 'active'
      GROUP BY import_channel
      ORDER BY import_channel
    `;
    r.match_by_channel = match;
  } catch (e: any) { r.match_err = e.message; }

  // 4. 最近 24h 新增的 TG 资源 (看今晚这一波)
  try {
    const recent = await sql`
      SELECT import_channel, COUNT(*)::int as cnt
      FROM xx_resources
      WHERE created_at > NOW() - INTERVAL '24 hours'
        AND status = 'active'
        AND import_channel LIKE 'tg_%'
      GROUP BY import_channel
    `;
    r.last_24h_tg = recent;
  } catch (e: any) { r.last_24h_err = e.message; }

  // 5. 多链接资源数 (有 > 1 副表链接)
  try {
    const multi = await sql`
      SELECT COUNT(DISTINCT resource_id)::int as multi_count
      FROM (
        SELECT resource_id, COUNT(*) as cnt
        FROM xx_resource_links
        WHERE status = 'active'
        GROUP BY resource_id
        HAVING COUNT(*) > 1
      ) m
    `;
    r.multi_link_resources = multi[0]?.multi_count;
  } catch (e: any) { r.multi_err = e.message; }

  return NextResponse.json(r);
}
