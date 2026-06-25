// /api/admin/stats/detailed - 详细统计大屏数据
// 返回: 30天序列 (资源增长/匹配/用户) + 各分类匹配率 + 各档位码数 + lumen 流水
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

export async function GET(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 1. 总览数据
    const totalRows = await sql`SELECT
        (SELECT COUNT(*)::int FROM xx_resources WHERE status = 'active') as total_resources,
        (SELECT COUNT(*)::int FROM xx_resources WHERE status = 'active' AND (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))) as unmatched,
        (SELECT COUNT(*)::int FROM xx_resources WHERE status = 'active' AND tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH', 'GARBLED')) as matched,
        (SELECT COUNT(*)::int FROM xx_users) as total_users,
        (SELECT COUNT(*)::int FROM xx_users WHERE user_group IN ('vip', 'admin') AND (expire_at IS NULL OR expire_at > NOW())) as vip_users,
        (SELECT COUNT(*)::int FROM xx_activation_codes) as total_codes,
        (SELECT COUNT(*)::int FROM xx_activation_codes WHERE is_used = true) as used_codes,
        (SELECT COUNT(*)::int FROM xx_user_unlocks) as total_unlocks,
        (SELECT COALESCE(SUM(change_amount), 0)::int FROM xx_lumen_logs WHERE type = 'credit') as lumen_in,
        (SELECT COALESCE(SUM(-change_amount), 0)::int FROM xx_lumen_logs WHERE type = 'debit') as lumen_out`;

    // 2. 30 天资源增长 (按天)
    const resourceGrowth = await sql`
      SELECT DATE(created_at) as date, COUNT(*)::int as cnt
      FROM xx_resources
      WHERE created_at >= NOW() - INTERVAL '30 days' AND status = 'active'
      GROUP BY DATE(created_at)
      ORDER BY date
    ` as any[];

    // 3. 30 天用户增长
    const userGrowth = await sql`
      SELECT DATE(created_at) as date, COUNT(*)::int as cnt
      FROM xx_users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    ` as any[];

    // 4. 分类匹配率
    const categoryMatch = await sql`
      SELECT category,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH', 'GARBLED'))::int as matched,
        COUNT(*) FILTER (WHERE tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))::int as unmatched
      FROM xx_resources
      WHERE status = 'active'
      GROUP BY category
      ORDER BY total DESC
    ` as any[];

    // 5. 卡密按类型
    const codesByType = await sql`
      SELECT code_type, COUNT(*)::int as total, COUNT(*) FILTER (WHERE is_used)::int as used
      FROM xx_activation_codes
      GROUP BY code_type
    ` as any[];

    // 6. 来源分布
    const sourceDist = await sql`
      SELECT COALESCE(source, 'unknown') as source, COUNT(*)::int as cnt
      FROM xx_resources
      WHERE status = 'active'
      GROUP BY source
      ORDER BY cnt DESC
      LIMIT 10
    ` as any[];

    // 7. lumen_cost 分布
    const lumenDist = await sql`
      SELECT lumen_cost, COUNT(*)::int as cnt
      FROM xx_resources
      WHERE status = 'active'
      GROUP BY lumen_cost
      ORDER BY lumen_cost
    ` as any[];

    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      totals: totalRows[0],
      resource_growth_30d: resourceGrowth,
      user_growth_30d: userGrowth,
      category_match: categoryMatch,
      codes_by_type: codesByType,
      source_dist: sourceDist,
      lumen_dist: lumenDist,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}