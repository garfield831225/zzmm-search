// 2026-08-04: P7 Preview 免登录 admin auto-inject
//   - GET /api/preview-login?key=xxx
//   - 校验 PREVIEW_KEY → 找 user_group='admin' 的第一个用户 → 签 admin JWT
//   - 只在 APP_ENV=preview 时生效 (生产环境返 403)
//   - setCookie zzmm_token + 返 { token, user } 给前端 localStorage 注入
//
// 安全: PREVIEW_KEY 是随机串, 只在 preview 部署有, 生产环境不配
// 副作用: preview 环境 localStorage 跟生产不跨域, 所以必须给 preview 单独注入

import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'cLWhs2015');

export async function GET(request: NextRequest) {
  // 1) 只有 preview 环境才允许
  if (process.env.APP_ENV !== 'preview') {
    return NextResponse.json({ error: 'preview 环境才能用这个端点' }, { status: 403 });
  }

  // 2) 校验 key
  const key = request.nextUrl.searchParams.get('key') || '';
  const expectedKey = process.env.PREVIEW_KEY || '';
  if (!expectedKey) {
    return NextResponse.json({ error: 'PREVIEW_KEY 未配置' }, { status: 500 });
  }
  if (key !== expectedKey) {
    return NextResponse.json({ error: 'key 错误' }, { status: 401 });
  }

  try {
    // 3) 找 user_group='admin' 的第一个用户
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });
    const rows = await sql`SELECT id, username, user_group, status FROM xx_users WHERE user_group = 'admin' AND status = 'active' ORDER BY id LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ error: '找不到 admin 用户' }, { status: 500 });
    }
    const admin = rows[0];

    // 4) 签 JWT (7 天有效, 跟生产一致)
    const token = await new SignJWT({
      id: admin.id,
      username: admin.username,
      user_group: admin.user_group,
      group: admin.user_group,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(JWT_SECRET);

    // 5) setCookie + 返 token
    const response = NextResponse.json({
      success: true,
      token,
      user: admin,
      message: '✅ preview admin token 已签发',
    });
    response.cookies.set('zzmm_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,  // preview 是 http
      path: '/',
      maxAge: 7 * 24 * 3600,
    });
    response.cookies.set('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 7 * 24 * 3600,
    });
    return response;
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
