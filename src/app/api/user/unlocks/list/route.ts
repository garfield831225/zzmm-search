// /api/user/unlocks/list - 用户解锁记录列表
// 2026-07-16: 支持 ?ids=1,2,3 查询参数, 返 unlockedIds 数组 (供 /library 单独付费区用)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 5;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET || 'cLWhs2015') as any;
    const userId = String(payload.id);
    const sql = neon(process.env.DATABASE_URL || '');

    // 2026-07-16: ids 参数 → 只返 unlockedIds (轻量查询, 给 library 用)
    const idsParam = req.nextUrl.searchParams.get('ids');
    if (idsParam) {
      const idList = idsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
      if (idList.length === 0) {
        return NextResponse.json({ ok: true, unlockedIds: [] });
      }
      try {
        const rows = await (sql as any).query(
          `SELECT resource_id FROM xx_user_unlocks WHERE user_id = $1 AND resource_id = ANY($2::int[])`,
          [userId, idList]
        ) as any[];
        const unlockedIds = (rows || []).map((r: any) => r.resource_id);
        return NextResponse.json({ ok: true, unlockedIds });
      } catch (e: any) {
        return NextResponse.json({ ok: true, unlockedIds: [], error: e.message?.slice(0, 100) });
      }
    }

    // 默认: 返解锁记录列表 (用于 /profile 或管理)
    const rows = await sql`
      SELECT u.id, u.resource_id, u.lumen_cost, u.unlocked_at,
             r.name as resource_name, r.category, r.size, r.source, r.link
      FROM xx_user_unlocks u
      LEFT JOIN xx_resources r ON u.resource_id = r.id
      WHERE u.user_id = ${userId}
      ORDER BY u.unlocked_at DESC
      LIMIT 100
    ` as any[];
    return NextResponse.json({ ok: true, items: rows, total: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}