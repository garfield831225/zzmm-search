// 2026-07-20: Admin 鉴权双轨统一函数 (Server 端)
// 双轨鉴权: 优先 Authorization Bearer, 退到 cookie (zzmm_token / token)
// - 子页面 fetch 默认不发 cookie, 必须显式 `credentials: 'include'`
// - Bearer 鉴权是主路径 (子页面从 localStorage token / adminToken / zzmm_token 读)
// - Cookie 鉴权是 fallback (httpOnly cookie 浏览器 JS 读不到, 但浏览器自动带)

import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export type AdminAuthResult =
  | { error: string; status: number; userId?: never }
  | { error?: never; status?: never; userId: string };

export function authAdmin(req: NextRequest | Request): AdminAuthResult {
  let token: string | null = null;
  const auth = (req as any).headers?.get?.('authorization');
  if (auth?.startsWith('Bearer ') && auth.length > 7) {
    token = auth.slice(7);
  } else if ((req as any).cookies?.get) {
    // NextRequest 有 cookies, 普通 Request 没有
    const c = (req as any).cookies;
    token = c.get('zzmm_token')?.value || c.get('token')?.value || null;
  }
  if (!token) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cLWhs2015') as any;
    if (String(payload.user_group || payload.group || '').toLowerCase() !== 'admin') {
      return { error: '需要 admin', status: 403 };
    }
    return { userId: String(payload.id) };
  } catch {
    return { error: 'token 无效', status: 401 };
  }
}

export function adminOnlyResponse(auth: AdminAuthResult) {
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return null;
}
