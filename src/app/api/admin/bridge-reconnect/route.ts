// /api/admin/bridge-reconnect - 手动重连 import-bridge
// 2026-08-01: 加这个路由让仪表盘"同步桥"卡片可以"重连"按钮触发
// 流程: 检查 bridge 状态 → 如果 ok 直接返 ok; 否则尝试 ping → 返新状态
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function POST(req: NextRequest) {
  // 鉴权
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return NextResponse.json({ error: '未登录' }, { status: 401 });
  try {
    jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
  } catch { return NextResponse.json({ error: 'Token 无效' }, { status: 401 }); }

  const url = process.env.IMPORT_BRIDGE_URL || 'http://www.zzmmemby.cn:58100';
  // 1) 先 ping /health
  let healthOk = false;
  let healthDetail: any = null;
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    healthOk = r.ok;
    healthDetail = await r.json();
  } catch (e: any) {
    healthDetail = { error: e.message };
  }
  // 2) 如果健康, 顺便触发一次 /info 看 push 接口
  let infoOk = false;
  let infoDetail: any = null;
  if (healthOk) {
    try {
      const r = await fetch(`${url}/info`, { signal: AbortSignal.timeout(5000) });
      infoOk = r.ok;
      infoDetail = await r.json();
    } catch (e: any) {
      infoDetail = { error: e.message };
    }
  }
  return NextResponse.json({
    ok: healthOk,
    bridge_url: url,
    checked_at: new Date().toISOString(),
    health: healthDetail,
    info: infoOk ? infoDetail : null,
    // 2026-08-01: 给前端一个"重连成功"或"重连失败"提示
    message: healthOk
      ? (infoOk ? '同步桥连通, push 接口正常' : '同步桥 /health 正常, /info 异常')
      : '同步桥 /health 不可达, 请检查 NAS Docker import-bridge 容器',
  });
}
