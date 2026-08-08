// 2026-07-17: /api/auth/logout - 清除 httpOnly cookie + 让 client 重新登录
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    // 清掉所有可能的 cookie 名字
    // 2026-08-08: 加 domain='.zzmm-search.uk' 才能清掉子域名 (lovemovie.zzmm-search.uk) 的 cookie
    cookieStore.set('zzmm_token', '', { httpOnly: true, path: '/', maxAge: 0, domain: '.zzmm-search.uk' });
    cookieStore.set('token', '', { httpOnly: true, path: '/', maxAge: 0, domain: '.zzmm-search.uk' });
    return NextResponse.json({ ok: true, message: '已退出登录' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET 也支持，方便 page 卸载/直接 fetch
export async function GET(req: NextRequest) {
  return POST(req);
}
