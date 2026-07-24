// 2026-07-24: import-hub 页面用的入库统计
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: '需要登录' }, { status: 401 });
  }
  // (不在 Edge 验签, 仅做存在检查; 真鉴权靠前端 redirect 到 /login)

  const sql = neon(process.env.DATABASE_URL || '');

  // 总数
  const totalRows = await sql(`SELECT COUNT(*)::int as n FROM xx_resources WHERE status='active'`);
  const total = totalRows[0]?.n || 0;

  // 按 import_channel 分组
  const channelRows = await sql(`
    SELECT COALESCE(import_channel, 'unknown') as channel, COUNT(*)::int as n, MAX(created_at) as last_import
    FROM xx_resources
    WHERE status='active'
    GROUP BY import_channel
    ORDER BY n DESC
  `);

  return NextResponse.json({
    success: true,
    total,
    channels: (channelRows || []).map((r: any) => ({
      channel: r.channel,
      count: r.n,
      last_import: r.last_import,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
