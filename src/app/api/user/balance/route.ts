// /api/user/balance - 用户余额查询
// 返回: { lumen_balance, user_group, expire_at, vip_active }
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

export async function GET(req: NextRequest) {
  const auth = getUserId(req.headers.get('authorization'));
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const users = await sql`SELECT id, username, user_group, expire_at, lumen_balance FROM xx_users WHERE id = ${auth.userId} LIMIT 1` as any[];
  if (!users[0]) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  const u = users[0];
  const vipActive = (u.user_group === 'vip' || u.user_group === 'admin') && (!u.expire_at || new Date(u.expire_at) > new Date());

  return NextResponse.json({
    ok: true,
    user_id: u.id,
    username: u.username,
    user_group: u.user_group,
    expire_at: u.expire_at,
    vip_active: vipActive,
    lumen_balance: u.lumen_balance || 0,
  });
}
