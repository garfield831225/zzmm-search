// 临时 diag: 按 access_level 查 + 看 library 分类逻辑
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  // 1. 全表 access_level 分布
  const byAccess = await sql`
    SELECT access_level, COUNT(*) as c
    FROM xx_resources
    WHERE status='active'
    GROUP BY access_level ORDER BY c DESC
  `;

  // 2. access_level × category 矩阵
  const matrix = await sql`
    SELECT access_level, category, COUNT(*) as c
    FROM xx_resources
    WHERE status='active'
    GROUP BY access_level, category
    ORDER BY access_level, c DESC
  `;

  // 3. access_level='vip' 的资源 (其他文档? 付费资源?)
  const vipRes = await sql`
    SELECT id, name, category, source, import_channel
    FROM xx_resources
    WHERE status='active' AND access_level = 'vip'
    ORDER BY id LIMIT 20
  `;

  // 4. access_level='code' 的资源 (付费资源专区?)
  const codeRes = await sql`
    SELECT id, name, category, source, import_channel, pay_type, code_price
    FROM xx_resources
    WHERE status='active' AND access_level = 'code'
    ORDER BY id LIMIT 20
  `;

  // 5. doc_sheet 不为空 (21-sheet 各 sheet 名) 分布
  const docSheets = await sql`
    SELECT doc_sheet, COUNT(*) as c
    FROM xx_resources
    WHERE status='active' AND doc_sheet IS NOT NULL AND doc_sheet != ''
    GROUP BY doc_sheet ORDER BY c DESC
  `;

  // 6. access_tier 分布
  const tier = await sql`
    SELECT access_tier, COUNT(*) as c
    FROM xx_resources
    WHERE status='active' GROUP BY access_tier
  `;

  // 7. pay_type 分布
  const pay = await sql`
    SELECT pay_type, COUNT(*) as c
    FROM xx_resources
    WHERE status='active' GROUP BY pay_type
  `;

  // 8. sub_type 分布
  const sub = await sql`
    SELECT sub_type, COUNT(*) as c
    FROM xx_resources
    WHERE status='active' AND sub_type IS NOT NULL AND sub_type != ''
    GROUP BY sub_type ORDER BY c DESC LIMIT 30
  `;

  return NextResponse.json({
    by_access_level: byAccess,
    matrix_access_category: matrix,
    vip_samples: vipRes,
    code_samples: codeRes,
    doc_sheets: docSheets,
    by_access_tier: tier,
    by_pay_type: pay,
    by_sub_type: sub,
  });
}
