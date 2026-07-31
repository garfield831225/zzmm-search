import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

// 2026-08-01: 修 Neon HTTP endpoint 5 分钟 stale cache (跟 catalog 同一根因, 见 memory #9)
//   /api/auth/me 返 stale expire_at → 前端 user.expire_at 是 7/29 (已过期 1 天) → 看着像 vip 失效
//   fetchConnectionCache = false + fetchOptions: { cache: 'no-store' } 真正 bypass Neon endpoint cache
neonConfig.fetchConnectionCache = false;
const sql = neon(process.env.DATABASE_URL || '', {
  fetchOptions: { cache: 'no-store' },
});

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function GET(req: NextRequest) {
  try {
    // 2026-07-16: 同时支持 Authorization Bearer + httpOnly cookie (修 redirect loop)
    // 之前只读 Authorization, 但 admin 登录后只存了 httpOnly cookie, localStorage 空
    // /admin/layout 拿到 localStorage 空就跳 /login, 死循环
    const authHeader = req.headers.get('authorization');
    let token: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '');
    } else {
      // 从 httpOnly cookie 读 (login route 30 天有效期)
      token = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value || null;
    }
    if (!token) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const payload = jwt.verify(token, JWT_SECRET) as any;

    // sql 已 module-level 用 neon() + fetchOptions: { cache: 'no-store' } (修 stale)
    const rows = await sql`SELECT id, username, user_group, expire_at, status, created_at, last_login FROM xx_users WHERE id = ${payload.id}`;
    const users = rows as any[];

    if (!users.length) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    return NextResponse.json({
      user: users[0],
      // 2026-07-16: 同时回 token, 让前端能存到 localStorage (修 redirect loop)
      // 前端拿到后写到 localStorage.token / localStorage.user, 下次刷新不再循环
      token: token,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}