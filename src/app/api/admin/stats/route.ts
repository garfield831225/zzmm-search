// /api/admin/stats - admin 统计
// 鉴权: Bearer JWT (adminOnly) 或 key=JWT_SECRET (兼容旧调用)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
  // 优先 Bearer 鉴权, 兼容 ?key=
  let authed = false;
  const a = adminOnly(req.headers.get('authorization'));
  if (!a.error) authed = true;

  if (!authed) {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (key === JWT_SECRET) authed = true;
  }
  if (!authed) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const url = new URL(req.url);
  const batchSize = Math.min(200, parseInt(url.searchParams.get('batch') || '50'));

  const sql = neon(process.env.DATABASE_URL || '');

  try {
    const cleaned = await sql`DELETE FROM xx_tmdb_cache WHERE cached_at < NOW() - INTERVAL '7 days'`.catch(() => []);

    const stats = await sql`
      SELECT category, COUNT(*) as cnt FROM xx_resources
      WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))
        AND status = 'active' AND name IS NOT NULL AND LENGTH(name) > 2
      GROUP BY category ORDER BY cnt DESC
    ` as any[];

    const total = await sql`
      SELECT COUNT(*) as cnt FROM xx_resources
      WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))
        AND status = 'active' AND name IS NOT NULL AND LENGTH(name) > 2
    ` as any[];

    const matchedTotal = await sql`
      SELECT COUNT(*) as cnt FROM xx_resources
      WHERE tmdb_id IS NOT NULL AND tmdb_id ~ '^[0-9]+$'
        AND status = 'active'
    ` as any[];

    const allTotal = await sql`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active'` as any[];

    return NextResponse.json({
      ok: true,
      cleaned: (cleaned as any).count || 0,
      by_category: stats.map((s: any) => ({ category: s.category, count: Number(s.cnt) })),
      total_pending: Number(total[0]?.cnt || 0),
      total_matched: Number(matchedTotal[0]?.cnt || 0),
      total_active: Number(allTotal[0]?.cnt || 0),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
