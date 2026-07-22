// 2026-07-14 临时诊断: 看 batch 是否真的写入了 xx_tmdb_cache + 业务规则调研
// 用法: GET /api/admin/diag-cache?key=zzmm-batch-test
import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  if (key !== 'zzmm-batch-test') {
    return NextResponse.json({ error: 'unauth' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // 1. cache 表总数 + 各时段增量
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

    // 2. 资源表整体状态
    const resources = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE tmdb_id IS NULL)::int as null_cnt,
        COUNT(*) FILTER (WHERE tmdb_id = 'NOMATCH')::int as nomatch_cnt,
        COUNT(*) FILTER (WHERE tmdb_id = 'GARBLED')::int as garbled_cnt,
        COUNT(*) FILTER (WHERE tmdb_id ~ '^[0-9]+$' AND tmdb_id::bigint > 0)::int as integer_ok,
        MAX(updated_at) FILTER (WHERE tmdb_id ~ '^[0-9]+$' AND tmdb_id::bigint > 0) as latest_match_update
      FROM xx_resources
      WHERE status = 'active'
    `;

    // 3. 业务调研 (2026-07-15): access_level × import_channel 交叉分布
    const bizCross = await sql`
      SELECT
        COALESCE(access_level, 'NULL') as access_level,
        COALESCE(import_channel, 'NULL') as import_channel,
        COUNT(*)::int as cnt
      FROM xx_resources
      WHERE status = 'active'
      GROUP BY access_level, import_channel
      ORDER BY cnt DESC
    `;

    // 4. source × access_level 分布 (看哪些 source 是 basic, 哪些是 vip)
    const sourceAccess = await sql`
      SELECT
        source,
        COALESCE(access_level, 'NULL') as access_level,
        COUNT(*)::int as cnt
      FROM xx_resources
      WHERE status = 'active'
      GROUP BY source, access_level
      ORDER BY cnt DESC
      LIMIT 30
    `;

    // 5. 脏数据: 非 zezhe 但 access_level='basic' 的资源 (这批就是 basic 用户能直接打开的)
    const dirtyBasic = await sql`
      SELECT
        source,
        COALESCE(import_channel, 'NULL') as import_channel,
        COUNT(*)::int as cnt
      FROM xx_resources
      WHERE status = 'active'
        AND COALESCE(import_channel, 'NULL') != 'zezhe'
        AND access_level = 'basic'
      GROUP BY source, import_channel
      ORDER BY cnt DESC
      LIMIT 20
    `;

    // 6. 真 zezhe 但 access_level 不等于 'basic' 的资源 (导入路由没正确设 access_level)
    const dirtyZezhe = await sql`
      SELECT
        COALESCE(access_level, 'NULL') as access_level,
        COUNT(*)::int as cnt
      FROM xx_resources
      WHERE status = 'active'
        AND import_channel = 'zezhe'
      GROUP BY access_level
      ORDER BY cnt DESC
    `;

    // 7. 导航栏入口路径存在性检查 (page.tsx 里的导航)
    // 用户不要 TMDB 影视区 / VIP 观影区
    // 这个不需要查 DB, 直接在路由里 hard-code 报告

    return NextResponse.json({
      now: new Date().toISOString(),
      cache: cache[0],
      resources: resources[0],
      biz: {
        cross: bizCross,
        sourceAccess: sourceAccess,
        dirty_basic_non_zezhe: dirtyBasic,  // 脏数据 1: 非 zezhe 但 access_level='basic' (basic 看到)
        dirty_zezhe_not_basic: dirtyZezhe,   // 脏数据 2: zezhe 但 access_level != 'basic'
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 500) }, { status: 500 });
  }
}
