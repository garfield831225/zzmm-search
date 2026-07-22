// 一次性 diag: 查 admin 用户的真实 group
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 5;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const admins = await sql`SELECT id, username, user_group, status FROM xx_users WHERE user_group = 'admin' OR username = 'admin' LIMIT 10`;
    const total = await sql`SELECT COUNT(*)::int as cnt FROM xx_users`;
    const groups = await sql`SELECT user_group, COUNT(*)::int as cnt FROM xx_users GROUP BY user_group ORDER BY cnt DESC`;

    // 测一下 /api/auth/me 怎么返 (模拟 cookie)
    const r = await sql`SELECT id FROM xx_users WHERE username = 'admin' LIMIT 1`;
    const adminId = r[0]?.id;
    let meTest: any = null;
    if (adminId) {
      // 模拟 token
      const jwt = await import('jsonwebtoken');
      const secret = process.env.JWT_SECRET || 'cLWhs2015';
      const token = jwt.sign({ id: adminId, username: 'admin', group: 'admin' }, secret, { expiresIn: '1h' });
      const r2 = await fetch('https://zzmm-search.cc.cd/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
      meTest = { status: r2.status, data: await r2.json() };
    }

    return NextResponse.json({
      total_users: total[0]?.cnt,
      groups,
      admins,
      admin_id: adminId,
      jwt_secret_env_set: !!process.env.JWT_SECRET,
      jwt_secret_fallback_used: process.env.JWT_SECRET === undefined,
      me_test: meTest,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 300) }, { status: 500 });
  }
}
