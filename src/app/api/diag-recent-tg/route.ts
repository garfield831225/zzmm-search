// 2026-07-18: diag - 查最近 X 小时 TG 新增的真实数
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const r: any = {};

  // 1. 最近 1h / 24h / 7d 新增的 TG 资源 (用 INSERT sql 写 read replica lag fix)
  for (const hours of [1, 6, 24, 72]) {
    const rows = await sql`
      SELECT import_channel, COUNT(*)::int as cnt
      FROM xx_resources
      WHERE created_at > NOW() - (${\`\${hours} hours\`})::interval
        AND status = 'active'
        AND import_channel LIKE 'tg_%'
      GROUP BY import_channel
    `;
    r[`last_${hours}h_tg`] = rows;
  }

  // 2. 全表 xx_resources 总数
  const total = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active'`;
  r.total_active = total[0]?.cnt;

  // 3. 副表总数
  const sub = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE status = 'active'`;
  r.sub_active = sub[0]?.cnt;

  // 4. 最新 5 条
  const recent5 = await sql`SELECT id, name, import_channel, source, created_at FROM xx_resources WHERE import_channel LIKE 'tg_%' ORDER BY id DESC LIMIT 5`;
  r.latest_5_tg = recent5;

  return NextResponse.json(r);
}
