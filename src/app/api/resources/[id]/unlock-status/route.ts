// /api/resources/[id]/unlock-status - 查资源解锁状态
// 返回: { unlocked, lumen_cost, lumen_balance (if user), user_vip_active }
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 5;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function getUserId(authHeader: string | null): { userId?: number; error?: string; status?: number } {
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: '未登录', status: 401 };
  }
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    return { userId: Number(payload.id) };
  } catch {
    return { error: 'Token 无效', status: 401 };
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const resourceId = Number(params.id);
  if (!Number.isInteger(resourceId)) {
    return NextResponse.json({ error: '资源 ID 无效' }, { status: 400 });
  }

  const auth = getUserId(req.headers.get('authorization'));
  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 查资源
    const resources = await sql`SELECT id, name, lumen_cost, is_vip_only, pay_type FROM xx_resources WHERE id = ${resourceId} AND status = 'active' LIMIT 1` as any[];
    if (!resources[0]) return NextResponse.json({ error: '资源不存在' }, { status: 404 });
    const r = resources[0];

    // 查解锁状态
    let unlocked = false;
    let lumenBalance = 0;
    let userVipActive = false;
    if (auth.userId) {
      const existing = await sql`SELECT id FROM xx_user_unlocks WHERE user_id = ${auth.userId} AND resource_id = ${resourceId} LIMIT 1` as any[];
      unlocked = !!existing[0];
      const users = await sql`SELECT lumen_balance, user_group, expire_at FROM xx_users WHERE id = ${auth.userId} LIMIT 1` as any[];
      if (users[0]) {
        lumenBalance = users[0].lumen_balance || 0;
        userVipActive = (users[0].user_group === 'vip' || users[0].user_group === 'admin') && (!users[0].expire_at || new Date(users[0].expire_at) > new Date());
      }
    }

    return NextResponse.json({
      ok: true,
      resource_id: resourceId,
      name: r.name,
      unlocked,
      lumen_cost: r.lumen_cost || 1,
      lumen_balance: lumenBalance,
      user_vip_active: userVipActive,
      is_vip_only: r.is_vip_only || false,
      pay_type: r.pay_type,
      need_login: !!auth.error,
    });
  } catch (e: any) {
    console.error('[unlock-status] error:', e);
    return NextResponse.json({ error: '查询失败: ' + (e.message || 'unknown') }, { status: 500 });
  }
}
