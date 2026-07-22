// 临时 diag: 查非 zezhe 资源分布 + xx_resources 字段
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'xx_resources' ORDER BY ordinal_position
  `;

  const total = await sql`
    SELECT COUNT(*) as c FROM xx_resources
    WHERE status='active' AND (import_channel != 'zezemom_excel' OR import_channel IS NULL)
  `;

  const byCat = await sql`
    SELECT category, COUNT(*) as c FROM xx_resources
    WHERE status='active' AND (import_channel != 'zezemom_excel' OR import_channel IS NULL)
    GROUP BY category ORDER BY c DESC
  `;

  const byChan = await sql`
    SELECT import_channel, COUNT(*) as c FROM xx_resources
    WHERE status='active' AND (import_channel != 'zezemom_excel' OR import_channel IS NULL)
    GROUP BY import_channel
  `;

  const keywords = ['演唱会', 'FLAC', 'Hi-Res', '专辑', 'WAV', 'SACD', 'DSD', 'HiFi',
                    '有声', '小说', '电子书', 'EPUB', 'MOBI', 'TXT',
                    '精品课', '课程', '讲座', '培训', '网课',
                    '文档', 'PDF', '教程', '讲义', '课件', '教材'];
  const samples: any = {};
  for (const kw of keywords) {
    const r = await sql`
      SELECT category, COUNT(*) as c FROM xx_resources
      WHERE status='active' AND (import_channel != 'zezemom_excel' OR import_channel IS NULL)
        AND name ILIKE ${'%' + kw + '%'}
      GROUP BY category ORDER BY c DESC
    `;
    samples[kw] = r;
  }

  return NextResponse.json({
    columns: cols.map(c => `${c.column_name} (${c.data_type})`),
    non_zezhe_total: parseInt(total[0]?.c || '0'),
    by_category: byCat,
    by_channel: byChan,
    keyword_samples: samples,
  });
}
