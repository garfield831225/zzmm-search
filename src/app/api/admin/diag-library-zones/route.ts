// 2026-07-16: 一次性 diag 端点 - 验证 /library 三区 SQL 过滤生效
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  try {
    const zezhe = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status='active' AND import_channel='zezemom_excel'`;
    const vip = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status='active' AND (import_channel IS NULL OR import_channel != 'zezemom_excel') AND (pay_type IS NULL OR pay_type != 'code')`;
    const code = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status='active' AND pay_type='code'`;
    const total = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status='active'`;

    // 各区 source 分布 (Top 8)
    const zezheBySource = await sql`SELECT source, COUNT(*)::int as cnt FROM xx_resources WHERE status='active' AND import_channel='zezemom_excel' GROUP BY source ORDER BY cnt DESC LIMIT 8`;
    const vipBySource = await sql`SELECT source, COUNT(*)::int as cnt FROM xx_resources WHERE status='active' AND (import_channel IS NULL OR import_channel != 'zezemom_excel') AND (pay_type IS NULL OR pay_type != 'code') GROUP BY source ORDER BY cnt DESC LIMIT 8`;
    const codeBySource = await sql`SELECT source, COUNT(*)::int as cnt FROM xx_resources WHERE status='active' AND pay_type='code' GROUP BY source ORDER BY cnt DESC LIMIT 8`;

    // ID 范围 (导入时间从先到后) - 验证排序用
    const first5 = await sql`SELECT id, name, import_channel, pay_type, created_at FROM xx_resources WHERE status='active' AND import_channel='zezemom_excel' ORDER BY created_at ASC LIMIT 5`;
    const last5 = await sql`SELECT id, name, import_channel, pay_type, created_at FROM xx_resources WHERE status='active' AND import_channel='zezemom_excel' ORDER BY created_at DESC LIMIT 5`;

    return NextResponse.json({
      total_active: total[0]?.cnt,
      zezhe: {
        count: zezhe[0]?.cnt,
        by_source: zezheBySource,
        first5_import_order: first5,
        last5: last5,
      },
      vip: {
        count: vip[0]?.cnt,
        by_source: vipBySource,
      },
      code: {
        count: code[0]?.cnt,
        by_source: codeBySource,
      },
      check: {
        zezhe_vip_code_sum: (zezhe[0]?.cnt || 0) + (vip[0]?.cnt || 0) + (code[0]?.cnt || 0),
        matches_total: (zezhe[0]?.cnt || 0) + (vip[0]?.cnt || 0) + (code[0]?.cnt || 0) === (total[0]?.cnt || 0),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 300) }, { status: 500 });
  }
}
