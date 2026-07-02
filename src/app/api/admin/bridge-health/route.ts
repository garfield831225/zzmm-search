// import-bridge 健康检查代理
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.IMPORT_BRIDGE_URL || 'http://www.zzmmemby.cn:58100';
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return NextResponse.json({ ok: r.ok, ...j, bridge_url: url });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message, bridge_url: url }, { status: 503 });
  }
}