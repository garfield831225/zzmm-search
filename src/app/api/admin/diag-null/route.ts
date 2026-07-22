// 临时 diag: 查 16,524 NULL tmdb_id 的 source + import_channel 分布
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  // 1. NULL tmdb_id 的 source 分布
  const bySource = await sql`
    SELECT source, COUNT(*) as c FROM xx_resources
    WHERE status='active' AND (tmdb_id IS NULL OR tmdb_id = 'NOMATCH')
    GROUP BY source ORDER BY c DESC
  `;

  // 2. NULL tmdb_id 的 import_channel 分布
  const byChan = await sql`
    SELECT import_channel, COUNT(*) as c FROM xx_resources
    WHERE status='active' AND (tmdb_id IS NULL OR tmdb_id = 'NOMATCH')
    GROUP BY import_channel
  `;

  // 3. NULL tmdb_id 的 category 分布
  const byCat = await sql`
    SELECT category, COUNT(*) as c FROM xx_resources
    WHERE status='active' AND (tmdb_id IS NULL OR tmdb_id = 'NOMATCH')
    GROUP BY category ORDER BY c DESC
  `;

  // 4. NULL tmdb_id 是不是 115 链接 (link LIKE '%115%' / '%115cdn%' / '%anxia%')
  const linkCheck = await sql`
    SELECT
      SUM(CASE WHEN link LIKE '%115.com%' OR link LIKE '%115cdn.com%' OR link LIKE '%anxia.com%' OR link LIKE '%115cdn%' THEN 1 ELSE 0 END) as is_115,
      SUM(CASE WHEN link LIKE '%115.com%' OR link LIKE '%115cdn.com%' OR link LIKE '%anxia.com%' OR link LIKE '%115cdn%' THEN 0 ELSE 1 END) as not_115,
      COUNT(*) as total
    FROM xx_resources
    WHERE status='active' AND (tmdb_id IS NULL OR tmdb_id = 'NOMATCH')
  `;

  // 5. NULL tmdb_id 非 115 的 source 分布
  const not115 = await sql`
    SELECT source, COUNT(*) as c FROM xx_resources
    WHERE status='active' AND (tmdb_id IS NULL OR tmdb_id = 'NOMATCH')
      AND NOT (link LIKE '%115.com%' OR link LIKE '%115cdn.com%' OR link LIKE '%anxia.com%' OR link LIKE '%115cdn%')
    GROUP BY source ORDER BY c DESC
  `;

  // 6. NULL tmdb_id 不是 115 的 title 关键词命中
  const keywords = ['演唱会', 'FLAC', 'Hi-Res', '专辑', 'SACD', 'DSD',
                    '有声', '小说', '电子书', 'EPUB', 'MOBI',
                    '精品课', '课程', '讲座', '培训',
                    '文档', 'PDF', '教程', '讲义', '课件', '教材'];
  const samples: any = {};
  for (const kw of keywords) {
    const r = await sql`
      SELECT source, category, COUNT(*) as c FROM xx_resources
      WHERE status='active' AND (tmdb_id IS NULL OR tmdb_id = 'NOMATCH')
        AND NOT (link LIKE '%115.com%' OR link LIKE '%115cdn.com%' OR link LIKE '%anxia.com%' OR link LIKE '%115cdn%')
        AND name ILIKE ${'%' + kw + '%'}
      GROUP BY source, category ORDER BY c DESC LIMIT 5
    `;
    samples[kw] = r;
  }

  return NextResponse.json({
    null_total: linkCheck[0]?.total,
    is_115: parseInt(linkCheck[0]?.is_115 || '0'),
    not_115: parseInt(linkCheck[0]?.not_115 || '0'),
    by_source: bySource,
    by_channel: byChan,
    by_category: byCat,
    not_115_by_source: not115,
    not_115_keyword_samples: samples,
  });
}
