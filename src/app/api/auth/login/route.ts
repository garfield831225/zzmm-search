import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

// 2026-08-13: 公共 API (moviezone + 子站) - 加 CORS 头
//   错误格式保持原样 {error: 'string'}, 不破坏 login page 现有行为
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// 加 CORS 的 json 响应
function jsonWithCors(body: any, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init?.headers as any || {}) } });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// 2026-07-29: 记录登录 IP + 城市识别 (用于后台 IP 风险监测)
// 异步调用, 失败不影响登录流程
async function recordLoginHistory(userId: number, req: NextRequest) {
  const ip = getClientIp(req.headers, 'unknown');
  const userAgent = req.headers.get('user-agent') || '';
  // ip-api.com 免费 (每分钟 45 次, 失败降级只存 IP)
  let city: string | null = null;
  let region: string | null = null;
  let country: string | null = null;
  let isp: string | null = null;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);  // 3s 超时
    const r = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN&fields=status,country,regionName,city,isp,query`, {
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (r.ok) {
      const d: any = await r.json();
      if (d.status === 'success') {
        city = d.city || null;
        region = d.regionName || null;
        country = d.country || null;
        isp = d.isp || null;
      }
    }
  } catch { /* 失败降级, IP 已知, 城市为 null */ }

  const sql = neon(process.env.DATABASE_URL || '');
  // 1) 写历史表
  await sql`
    INSERT INTO xx_login_history (user_id, ip, city, region, country, isp, user_agent, login_at)
    VALUES (${userId}, ${ip}, ${city}, ${region}, ${country}, ${isp}, ${userAgent}, NOW())
  `;
  // 2) 更新 user 最近登录 IP (后台列表查询快)
  await sql`UPDATE xx_users SET last_login_ip = ${ip}, last_login_city = ${city} WHERE id = ${userId}`;
}

export async function POST(req: NextRequest) {
  try {
    const { username, password, captcha } = await req.json();

    // 验证码校验（可选，跳过也不阻止登录）
//     const storedCaptcha = req.cookies.get('captcha_code')?.value || '';
//     if (captcha && storedCaptcha && captcha.toLowerCase() !== storedCaptcha.toLowerCase()) {
//       return NextResponse.json({ error: '验证码错误' }, { status: 400 });
//     }

    if (!username || !password) {
      return jsonWithCors({ error: '用户名和密码不能为空' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    const rows = await sql`SELECT id, username, password_hash, user_group, expire_at, status FROM xx_users WHERE username = ${username}`;
    const users = rows as any[];

    if (!users.length) {
      return jsonWithCors({ error: '用户名或密码错误' }, { status: 401 });
    }

    const user = users[0];
    if (user.status !== 'active') {
      return jsonWithCors({ error: '账号已被禁用' }, { status: 403 });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return jsonWithCors({ error: '用户名或密码错误' }, { status: 401 });
    }

    // 更新最后登录时间 (同步, 单点登录挤下线依赖此时间戳)
    // 2026-07-29: 同步更新, 失败抛错, 不静默吞错 (last_login 没更新 = 旧 token 立刻失效)
    await sql`UPDATE xx_users SET last_login = NOW(), updated_at = NOW() WHERE id = ${user.id}`;

    // 2026-07-29: 记录登录 IP + 城市识别 (异步, 失败不影响登录)
    // ip-api.com 免费 45 req/min, 失败降级只存 IP
    recordLoginHistory(user.id, req).catch((e) => console.error('[login-history]', e.message));

    const token = jwt.sign(
      { id: user.id, username: user.username, group: user.user_group },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // 设置 HTTP-only cookie（供 middleware 读取）
    // 2026-08-08: 加 domain='.zzmm-search.uk' 让 lovemovie.zzmm-search.uk 子域名也能读到
    // (server.py 8688 在子域名下做鉴权, 必须共享 cookie)
    const cookieStore = await cookies();
    cookieStore.set('zzmm_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
      domain: '.zzmm-search.uk',
    });

    return jsonWithCors({
      token,
      user: {
        id: user.id,
        username: user.username,
        group: user.user_group,
        expire_at: user.expire_at,
      },
    });
  } catch (e: any) {
    return jsonWithCors({ error: e.message }, { status: 500 });
  }
}