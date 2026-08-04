import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { parseNeonTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

// 2026-08-01: 修 Neon HTTP endpoint 5 分钟 stale cache (memory #9)
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
    // 2026-08-01: ::text 强转, 避免 neon() SDK 返 raw Date 自身有 tz bug (前端 new Date() 少 8h)
    const rows = await sql`SELECT id, username, user_group, expire_at::text as expire_at, status, created_at::text as created_at, last_login::text as last_login FROM xx_users WHERE id = ${payload.id}`;
    const users = rows as any[];

    if (!users.length) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 2026-08-01: 用 parseNeonTime 修 Neon HTTP 端 timestamptz 缺 tz 标记 bug
    //   不然 user.expire_at 在前端 new Date() 解析少 8h → profile 显示过期
    const u = users[0];
    if (u?.expire_at) u.expire_at = parseNeonTime(u.expire_at);
    if (u?.created_at) u.created_at = parseNeonTime(u.created_at);
    if (u?.last_login) u.last_login = parseNeonTime(u.last_login);

    // 2026-08-04 P8: VIP 过期 lazy check (idempotent, 跟 cron 端点逻辑一致)
    //   - user_group='vip' AND status='active' AND expire_at < now() → 降级 basic
    //   - 写 lumen_logs 流水
    //   - 每次 /api/auth/me 都检查, 防止 cron 没跑时用户还在用 VIP 权限
    //   - 单点登录: 新 last_login 强制旧 token 失效, 用户重新登录会拿到 basic token
    if (u?.user_group === 'vip' && u?.status === 'active' && u?.expire_at) {
      const expireMs = new Date(u.expire_at).getTime();
      if (expireMs < Date.now()) {
        // 过期了, 降级
        try {
          await sql`UPDATE xx_users SET user_group = 'basic' WHERE id = ${u.id} AND user_group = 'vip'`;
          await sql`
            INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, ref_code, description, created_at)
            VALUES (${u.id}, 0, 0, 'expire', NULL, ${`VIP 过期降级 basic (lazy check, expire_at=${u.expire_at})`}, NOW())
          `;
          u.user_group = 'basic';
        } catch (e: any) {
          console.error('[auth/me] lazy expire check failed:', e.message);
        }
      }
    }

    return NextResponse.json({
      user: u,
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