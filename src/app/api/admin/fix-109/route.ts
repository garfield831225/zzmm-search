// 把 109 tg_baidu/tg_quark active 资源也设成 vip (跟新规则保持一致)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  const mode = request.nextUrl.searchParams.get('mode'); // preview | execute | verify
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  if (!['preview', 'execute', 'verify'].includes(mode || '')) {
    return NextResponse.json({ error: 'mode required: preview|execute|verify' }, { status: 400 });
  }
  const sql = neon(process.env.DATABASE_URL || '');

  if (mode === 'preview') {
    // 看现在 109 tg 资源是什么状态
    const tg = await sql`
      SELECT id, name, category, source, import_channel, access_level, access_tier, pay_type, status
      FROM xx_resources
      WHERE import_channel IN ('tg_baidu', 'tg_quark') AND status = 'active'
    `;
    return NextResponse.json({ mode: 'preview', count: tg.length, samples: tg.slice(0, 5), all: tg });
  }

  if (mode === 'execute') {
    // 把 109 tg active 资源改成 access_level='vip', pay_type='vip' (跟新规则保持一致)
    // 不改 import_channel, status
    const before = await sql`
      SELECT COUNT(*) c FROM xx_resources
      WHERE import_channel IN ('tg_baidu', 'tg_quark') AND status='active'
        AND (access_level = 'basic' OR pay_type = 'free')
    `;
    await sql`
      UPDATE xx_resources
      SET access_level = 'vip', pay_type = 'vip', updated_at = NOW()
      WHERE import_channel IN ('tg_baidu', 'tg_quark') AND status='active'
        AND (access_level = 'basic' OR pay_type = 'free')
    `;
    const after = await sql`
      SELECT COUNT(*) c FROM xx_resources
      WHERE import_channel IN ('tg_baidu', 'tg_quark') AND status='active'
        AND access_level = 'basic'
    `;
    return NextResponse.json({ mode: 'execute', updated: parseInt(before[0]?.c || '0'), still_basic: parseInt(after[0]?.c || '0') });
  }

  if (mode === 'verify') {
    // 验证全表规则一致性
    const summary = await sql`
      SELECT
        CASE
          WHEN import_channel = 'zezemom_excel' THEN 'zezhe (应该 basic+free)'
          WHEN import_channel IN ('tg_baidu', 'tg_quark', 'tg_music') THEN 'tg (应该 vip+vip)'
          ELSE '其他'
        END as group_type,
        access_level, pay_type, COUNT(*) as c
      FROM xx_resources
      WHERE status = 'active'
      GROUP BY group_type, access_level, pay_type
      ORDER BY group_type, c DESC
    `;
    return NextResponse.json({ mode: 'verify', summary });
  }

  return NextResponse.json({ error: 'unreachable' }, { status: 500 });
}
