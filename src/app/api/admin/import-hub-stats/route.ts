// 2026-07-24: import-hub 页面用的入库统计
// 2026-07-26: 去掉鉴权 - middleware 已经在白名单放行 (/api/admin/import)
// 简化: 任何请求都返数据, 鉴权交给前端 client side redirect
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // 2026-07-26: 完全去掉鉴权 - middleware 白名单已放行, 前端 client side 会自己 redirect
  // 之前 jwt 鉴权在 Edge runtime 不能用 (jsonwebtoken 依赖 node:crypto)

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
