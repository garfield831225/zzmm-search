// 2026-07-17: /api/auth/logout - 清除 httpOnly cookie + 让 client 重新登录
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    // 清掉所有可能的 cookie 名字
    cookieStore.set('zzmm_token', '', { httpOnly: true, path: '/', maxAge: 0 });
    cookieStore.set('token', '', { httpOnly: true, path: '/', maxAge: 0 });
    return NextResponse.json({ ok: true, message: '已退出登录' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET 也支持，方便 page 卸载/直接 fetch
export async function GET(req: NextRequest) {
  return POST(req);
}
