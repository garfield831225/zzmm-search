// 2026-07-17: 曝露服务端实际收到的所有 cookie + header
// 排查 user 为什么点 /admin 跳 /login (服务端说是没 cookie)
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const allCookies = req.cookies.getAll();
  const token = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value;

  let jwtResult: any = null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'cLWhs2015');
      jwtResult = { valid: true, payload };
    } catch (e: any) {
      jwtResult = { valid: false, error: e.message };
    }
  }

  return NextResponse.json({
    cookies_count: allCookies.length,
    cookies: allCookies.map(c => ({
      name: c.name,
      value_prefix: c.value.slice(0, 30),
      value_length: c.value.length,
    })),
    zzmm_token_found: !!req.cookies.get('zzmm_token'),
    token_fallback_found: !!req.cookies.get('token'),
    token_length: token?.length || 0,
    token_first_20: token?.slice(0, 20) || null,
    jwt_result: jwtResult,
    headers: {
      'user-agent': req.headers.get('user-agent')?.slice(0, 100),
      'cookie-header': req.headers.get('cookie')?.slice(0, 200) || null,
      'sec-fetch-mode': req.headers.get('sec-fetch-mode'),
      'sec-fetch-site': req.headers.get('sec-fetch-site'),
    },
  });
}
