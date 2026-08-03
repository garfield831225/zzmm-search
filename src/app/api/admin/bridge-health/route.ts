// import-bridge 健康检查代理
// 2026-08-01: 加 JWT admin 鉴权 (之前没鉴权, middleware 跳走返 307 跳 login, dashboard 显示"检测中")
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function GET(req: NextRequest) {
  // JWT 鉴权: 仅 admin 可看
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  let isAdmin = false;
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET) as any;
    isAdmin = payload?.user_group === 'admin' || payload?.group === 'admin';
  } catch { return NextResponse.json({ ok: false, error: 'Token 无效' }, { status: 401 }); }
  if (!isAdmin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 });

  const url = process.env.IMPORT_BRIDGE_URL || 'http://www.zzmmemby.cn:58100';
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return NextResponse.json({ ok: r.ok, ...j, bridge_url: url, checked_at: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message, bridge_url: url, checked_at: new Date().toISOString() }, { status: 503 });
  }
}