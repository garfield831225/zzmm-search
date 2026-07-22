// 临时 diag: 列出所有表 + 各表数据量
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  // 1. 列出所有表
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;

  // 2. 每个表的 count
  const counts: any = {};
  for (const t of tables) {
    const name = t.table_name;
    try {
      const r = await sql(`SELECT COUNT(*) as c FROM ${name}`);
      counts[name] = parseInt(r[0]?.c || '0');
    } catch (e: any) {
      counts[name] = 'err: ' + e.message?.slice(0, 100);
    }
  }

  // 3. 类似 vip / 文档 / pay / premium / 非影视 的关键表深度查
  const candidates = ['xx_vip', 'xx_vip_documents', 'xx_vip_docs', 'xx_documents',
                      'xx_premium', 'xx_paid', 'xx_pay_links', 'xx_pay_resources',
                      'xx_other_docs', 'xx_other_resources', 'xx_external_links',
                      'xx_user_unlocks'];
  for (const t of candidates) {
    if (!counts[t]) {
      try {
        const r = await sql(`SELECT COUNT(*) as c FROM ${t}`);
        counts[t] = parseInt(r[0]?.c || '0') + ' (extra)';
      } catch { /* skip */ }
    }
  }

  // 4. xx_resources 各种 access_/pay_/doc_ 字段
  const accessLevels = await sql`SELECT access_level, COUNT(*) c FROM xx_resources WHERE status='active' GROUP BY access_level`;
  const accessTiers = await sql`SELECT access_tier, COUNT(*) c FROM xx_resources WHERE status='active' GROUP BY access_tier`;
  const payTypes = await sql`SELECT pay_type, COUNT(*) c FROM xx_resources WHERE status='active' GROUP BY pay_type`;

  // 5. 5+ 张含 link 字段的表查 access 信息
  const linkyTables: any = {};
  for (const tname of ['xx_resources', 'xx_games']) {
    try {
      const samples = await sql(`SELECT id, name, source, category, access_level, access_tier, pay_type, link FROM ${tname} WHERE link IS NOT NULL AND link != '' LIMIT 3`);
      linkyTables[tname] = { count_with_link: samples.length, samples };
    } catch { /* skip */ }
  }

  return NextResponse.json({
    all_tables_count: counts,
    xx_resources_access_level: accessLevels,
    xx_resources_access_tier: accessTiers,
    xx_resources_pay_type: payTypes,
    link_samples: linkyTables,
  });
}
