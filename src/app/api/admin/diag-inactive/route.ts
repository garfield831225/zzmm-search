// 临时 diag: 16,067 inactive 详查
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  // 1. inactive 分类分布
  const byCat = await sql`
    SELECT category, COUNT(*) as c FROM xx_resources
    WHERE status='inactive' GROUP BY category ORDER BY c DESC
  `;

  // 2. inactive source 分布
  const bySrc = await sql`
    SELECT source, COUNT(*) as c FROM xx_resources
    WHERE status='inactive' GROUP BY source
  `;

  // 3. inactive import_channel 分布
  const byChan = await sql`
    SELECT import_channel, COUNT(*) as c FROM xx_resources
    WHERE status='inactive' GROUP BY import_channel
  `;

  // 4. inactive access_level 分布
  const byAccess = await sql`
    SELECT access_level, access_tier, pay_type, COUNT(*) as c FROM xx_resources
    WHERE status='inactive' GROUP BY access_level, access_tier, pay_type ORDER BY c DESC
  `;

  // 5. inactive 是不是 115
  const linkCheck = await sql`
    SELECT
      SUM(CASE WHEN link LIKE '%115.com%' OR link LIKE '%115cdn.com%' OR link LIKE '%anxia.com%' OR link LIKE '%115cdn%' THEN 1 ELSE 0 END) as is_115,
      SUM(CASE WHEN link LIKE '%115.com%' OR link LIKE '%115cdn.com%' OR link LIKE '%anxia.com%' OR link LIKE '%115cdn%' THEN 0 ELSE 1 END) as not_115,
      COUNT(*) as total
    FROM xx_resources
    WHERE status='inactive'
  `;

  // 6. inactive doc_sheet 分布
  const sheets = await sql`
    SELECT doc_sheet, COUNT(*) as c FROM xx_resources
    WHERE status='inactive' AND doc_sheet IS NOT NULL AND doc_sheet != ''
    GROUP BY doc_sheet ORDER BY c DESC
  `;

  // 7. inactive 关键词命中 (VIP/电子书/精品课/文档/有声/教程/PDF/小说)
  const keywords = ['VIP', '文档', '电子书', '精品课', '有声', '教程', 'PDF', '小说', '其他', 'dedicated', 'premium'];
  const samples: any = {};
  for (const kw of keywords) {
    const r = await sql`
      SELECT category, source, import_channel, access_level, COUNT(*) as c FROM xx_resources
      WHERE status='inactive' AND name ILIKE ${'%' + kw + '%'}
      GROUP BY category, source, import_channel, access_level ORDER BY c DESC LIMIT 5
    `;
    if (r.length > 0) samples[kw] = r;
  }

  // 8. sample 10 个 inactive title + link
  const samples10 = await sql`
    SELECT id, name, link, category, source, import_channel, access_level, access_tier, pay_type, status, doc_sheet
    FROM xx_resources WHERE status='inactive' ORDER BY id DESC LIMIT 10
  `;

  return NextResponse.json({
    total_inactive: parseInt(linkCheck[0]?.total || '0'),
    is_115: parseInt(linkCheck[0]?.is_115 || '0'),
    not_115: parseInt(linkCheck[0]?.not_115 || '0'),
    by_category: byCat,
    by_source: bySrc,
    by_channel: byChan,
    by_access: byAccess,
    by_doc_sheet: sheets,
    keyword_hits: samples,
    samples: samples10,
  });
}
