// 2026-08-04: /api/vip/client-error - 临时 debug 端点, 让 ErrorBoundary 自动上报 client 错误
//   - POST 收 { error, stack, componentStack, page, userAgent, ts }
//   - 写到 /tmp/zzmm-vip-errors.log (NAS)
//   - 调试完成后可删

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const line = `\n=== ${new Date().toISOString()} ${body.page || '?'} ===\nERROR: ${body.error}\nSTACK: ${body.stack?.slice(0, 800)}\nUA: ${body.userAgent?.slice(0, 200)}\n`;
    const fs = await import('fs');
    try {
      fs.appendFileSync('/tmp/zzmm-vip-errors.log', line);
    } catch (e) {
      // 写不进 /tmp 就 stdout
      console.log('[vip-error]', line);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
