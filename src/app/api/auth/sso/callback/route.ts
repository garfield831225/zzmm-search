// /api/auth/sso/callback - zzmm-search 端 SSO 回调
// 流程: scraper 跳回 /api/auth/sso/callback?token=xxx&callback=...
// 1. 拿 token
// 2. 用 SSO_JWT_SECRET HS256 验 token (来自 scraper Vercel env SSO_JWT_SECRET)
// 3. 拿 token payload {email, user_id, vip_expire_at, vip_level, points}
// 4. 查 sso_tokens 表 (scraper 端) - 可选, 由 scraper callback 内部验证
// 5. 查/创 zzmm-search 端 xx_users.username = email
// 6. 签 zzmm-search 自己的 JWT 写 cookie
// 7. 重定向到原页面
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';
const SSO_JWT_SECRET = process.env.SSO_JWT_SECRET; // 来自 scraper Vercel env (用户转达填入, 不贴消息)
// ⚠️ 不能 fallback 到默认值! 不写 fallback 是有意为之: 万一 env 没配就报错, 不让代码用公开默认密钥"装作加密"
const SCRAPER_API_BASE = 'https://scraper.cc.cd';

interface SsoPayload {
  email: string;
  user_id?: string;
  vip_expire_at?: number;
  vip_level?: number;
  points?: number;
  exp?: number; // JWT 标准 5min 过期
}

// 用 SSO_JWT_SECRET HS256 验 scraper 颁发的 sso_token
function verifySsoToken(token: string): SsoPayload | null {
  if (!SSO_JWT_SECRET) {
    console.error('[sso-callback] SSO_JWT_SECRET not configured - refusing to verify token (防公开默认密钥陷阱)');
    return null;
  }
  try {
    const payload = jwt.verify(token, SSO_JWT_SECRET, { algorithms: ['HS256'] }) as SsoPayload;
    return payload;
  } catch (e: any) {
    console.error('[sso-callback] SSO token verify failed:', e.message);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const callback = request.nextUrl.searchParams.get('callback') || '/';

  if (!token) {
    return new NextResponse(
      '<html><body><h1>SSO Error</h1><p>Missing token</p></body></html>',
      { status: 400, headers: { 'Content-Type': 'text/html' } }
    );
  }

  // 1. 验 token
  const payload = verifySsoToken(token);
  if (!payload || !payload.email) {
    return new NextResponse(
      `<html><body><h1>SSO Login Failed</h1><p>Token invalid or expired</p><p><a href="/login">Back to login</a></p></body></html>`,
      { status: 401, headers: { 'Content-Type': 'text/html' } }
    );
  }

  // 2. 查/创 zzmm-search 端 xx_users + 创 lumen 行
  // v2.1.3: VIP 不跨站共享, 只共享账号
  const sql = neon(process.env.DATABASE_URL || '');
  const email = payload.email;
  const existing = await sql`SELECT u.id, u.user_group, u.expire_at, COALESCE(l.balance, 0) as lumen_balance
                            FROM xx_users u
                            LEFT JOIN xx_user_lumen l ON l.user_id = u.id
                            WHERE u.username = ${email} LIMIT 1` as any[];

  let userId: number;
  let lumenBalance = 0;
  if (existing[0]) {
    userId = existing[0].id;
    lumenBalance = existing[0].lumen_balance || 0;
  } else {
    // 创用户 - SSO 来的用户, password_hash 留空
    const inserted = await sql`INSERT INTO xx_users (username, password_hash, user_group, status, is_verified, created_at, updated_at)
                              VALUES (${email}, '', 'user', 'active', true, NOW(), NOW()) RETURNING id` as any[];
    userId = inserted[0].id;
    // 创 lumen 行
    await sql`INSERT INTO xx_user_lumen (user_id, balance) VALUES (${userId}, 0) ON CONFLICT (user_id) DO NOTHING`;
  }

  // 3. v2.1.3 修正: 不再跨站共享 VIP 时长
  // SSO 之前也共享了 vip_expire_at (v1.2 行为), v2.1.3 改为只共享账号, VIP 各买各的
  // (mov 端 mov 自己处理 mov 端 VIP)
  // v2.1.3 禁用跨站 VIP 双写 - 整段禁用
  /*
  if (payload?.vip_expire_at) {
    const newExpire = new Date(payload.vip_expire_at * 1000);
    await sql`UPDATE xx_users
              SET expire_at = GREATEST(${newExpire.toISOString()}::timestamptz, COALESCE(expire_at, NOW())),
                  user_group = CASE
                    WHEN user_group = 'admin' THEN 'admin'
                    ELSE 'vip'
                  END
              WHERE id = ${userId}`;
  }
  */

  // 4. 签 zzmm-search 自己的 JWT
  const zzmmToken = jwt.sign(
    { id: userId, email, user_group: payload.vip_level ? 'vip' : 'user', lumen_balance: lumenBalance },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // 5. 返回 HTML: 写 localStorage + 跳 callback
  // 模仿 scraper-app callback 的做法, 不用 302 避免 cookie 跨域问题
  const safeCallback = callback.startsWith('/') ? callback : '/';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SSO Login...</title>
<script>
  try {
    localStorage.setItem('zzmm_token', ${JSON.stringify(zzmmToken)});
    localStorage.setItem('token', ${JSON.stringify(zzmmToken)});
    document.cookie = 'zzmm_token=' + ${JSON.stringify(zzmmToken)} + '; path=/; max-age=604800; SameSite=Lax';
  } catch(e) { console.error(e); }
  window.location.href = ${JSON.stringify(safeCallback)};
</script>
</head><body>
<p>SSO 登录中, 请稍候...</p>
<p><a href=${JSON.stringify(safeCallback)}>点此手动跳转</a></p>
</body></html>`;
  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
