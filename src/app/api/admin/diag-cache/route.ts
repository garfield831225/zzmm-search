// 2026-07-14 临时诊断: 看 batch 是否真的写入了 xx_tmdb_cache
// 用法: GET /api/admin/diag-cache?key=zzmm-batch-test
import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  // 临时: 跟 /api/admin/match 一致的免鉴权 key
  if (key !== 'zzmm-batch-test') {
    return NextResponse.json({ error: 'unauth' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // 1. cache 表总数 + 各时段增量 (看 batch 跑期间有没有新增)
    const cache = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE cached_at > NOW() - INTERVAL '15 minutes')::int as recent_15m,
        COUNT(*) FILTER (WHERE cached_at > NOW() - INTERVAL '1 hour')::int as recent_1h,
        COUNT(*) FILTER (WHERE cached_at > NOW() - INTERVAL '2 hours')::int as recent_2h,
        COUNT(*) FILTER (WHERE cached_at > NOW() - INTERVAL '24 hours')::int as recent_24h,
        MIN(cached_at) as oldest,
        MAX(cached_at) as newest
      FROM xx_tmdb_cache
    `;

    // 2. 资源表里 batch 报告的命中区间 (id 范围 1-24000 已处理, 但 batch 是 id 升序 SELECT, 所以前 254 个 match 应该在小 id 范围)
    // 直接看 xx_resources 状态分布 (跟 stats 一致, 但用不同的 SELECT, 防止 stats 缓存)
    const resources = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE tmdb_id IS NULL)::int as null_cnt,
        COUNT(*) FILTER (WHERE tmdb_id = 'NOMATCH')::int as nomatch_cnt,
        COUNT(*) FILTER (WHERE tmdb_id = 'GARBLED')::int as garbled_cnt,
        COUNT(*) FILTER (WHERE tmdb_id ~ '^[0-9]+$' AND tmdb_id::bigint > 0)::int as integer_ok,
        COUNT(*) FILTER (WHERE tmdb_id ~ '^[0-9]+$' AND tmdb_id::bigint = 0)::int as integer_zero,
        COUNT(*) FILTER (WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH','GARBLED') AND tmdb_id !~ '^[0-9]+$')::int as other,
        MAX(updated_at) FILTER (WHERE tmdb_id ~ '^[0-9]+$' AND tmdb_id::bigint > 0) as latest_match_update
      FROM xx_resources
      WHERE status = 'active'
    `;

    // 3. 最近 1 小时改过 tmdb_id 的资源 (看 batch 实际写入数)
    const recentUpdates = await sql`
      SELECT
        COUNT(*) FILTER (WHERE tmdb_id ~ '^[0-9]+$' AND tmdb_id::bigint > 0 AND updated_at > NOW() - INTERVAL '1 hour')::int as integer_ok_recent,
        COUNT(*) FILTER (WHERE tmdb_id = 'NOMATCH' AND updated_at > NOW() - INTERVAL '1 hour')::int as nomatch_recent,
        COUNT(*) FILTER (WHERE tmdb_id IS NULL AND updated_at > NOW() - INTERVAL '1 hour')::int as null_recent,
        COUNT(*) FILTER (WHERE last_attempt_at > NOW() - INTERVAL '1 hour')::int as last_attempt_recent
      FROM xx_resources
      WHERE status = 'active'
    `;

    return NextResponse.json({
      now: new Date().toISOString(),
      cache: cache[0],
      resources: resources[0],
      recentUpdates: recentUpdates[0],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 500) }, { status: 500 });
  }
}
