// /api/user/unlocks/list - 用户解锁记录列表
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