// 临时 diag: 全面查 xx_resources 各种维度 + xx_games 表
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  // 1. 全表 source × category 矩阵
  const allMatrix = await sql`
    SELECT source, category, COUNT(*) as c
    FROM xx_resources
    WHERE status='active'
    GROUP BY source, category
    ORDER BY source, c DESC
  `;

  // 2. 全表 import_channel × source
  const chanSource = await sql`
    SELECT import_channel, source, COUNT(*) as c
    FROM xx_resources
    WHERE status='active'
    GROUP BY import_channel, source
    ORDER BY import_channel, c DESC
  `;

  // 3. 非 115 资源 (不限 tmdb_id) 的全部分布
  const non115 = await sql`
    SELECT source, category, import_channel, COUNT(*) as c
    FROM xx_resources
    WHERE status='active'
      AND NOT (link LIKE '%115.com%' OR link LIKE '%115cdn.com%' OR link LIKE '%anxia.com%' OR link LIKE '%115cdn%')
    GROUP BY source, category, import_channel
    ORDER BY c DESC
  `;

  // 4. 非 115 资源 title 关键词命中 (各种分类候选)
  const keywords = ['演唱会', 'FLAC', 'Hi-Res', '专辑', 'WAV', 'SACD', 'DSD', 'HiFi',
                    '有声', '小说', '电子书', 'EPUB', 'MOBI', 'TXT',
                    '精品课', '课程', '讲座', '培训', '网课', '教学',
                    '文档', 'PDF', '教程', '讲义', '课件', '教材', 'PPT'];
  const samples: any = {};
  for (const kw of keywords) {
    const r = await sql`
      SELECT source, category, import_channel, COUNT(*) as c
      FROM xx_resources
      WHERE status='active'
        AND NOT (link LIKE '%115.com%' OR link LIKE '%115cdn.com%' OR link LIKE '%anxia.com%' OR link LIKE '%115cdn%')
        AND name ILIKE ${'%' + kw + '%'}
      GROUP BY source, category, import_channel
      ORDER BY c DESC LIMIT 5
    `;
    if (r.length > 0) samples[kw] = r;
  }

  // 5. xx_games 表是否存在 + 数量
  let gamesInfo: any = { exists: false };
  try {
    const r = await sql`SELECT COUNT(*) as c FROM xx_games`;
    gamesInfo = { exists: true, total: parseInt(r[0]?.c || '0') };
    if (gamesInfo.total > 0) {
      const platform = await sql`SELECT platform, COUNT(*) as c FROM xx_games GROUP BY platform ORDER BY c DESC LIMIT 10`;
      gamesInfo.platforms = platform;
    }
  } catch (e: any) {
    gamesInfo.error = e.message?.slice(0, 200);
  }

  // 6. /api/games 用的什么表
  let gamesApiTables: any = {};
  for (const t of ['xx_games', 'xx_movies', 'xx_resources', 'xx_vip']) {
    try {
      const r = await sql(`SELECT COUNT(*) as c FROM ${t}`);
      gamesApiTables[t] = parseInt(r[0]?.c || '0');
    } catch { gamesApiTables[t] = 'no'; }
  }

  // 7. 全部 source 列表
  const allSources = await sql`
    SELECT source, COUNT(*) as c FROM xx_resources
    WHERE status='active' GROUP BY source ORDER BY c DESC
  `;

  // 8. /nonfilm 相关: category IN (音乐,体育,电子书,精品课,文档) 不分 115 与否
  const nonfilmAll = await sql`
    SELECT source, category, import_channel, COUNT(*) as c
    FROM xx_resources
    WHERE status='active' AND category IN ('音乐', '体育', '电子书', '精品课', '文档', '游戏')
    GROUP BY source, category, import_channel
    ORDER BY category, c DESC
  `;

  return NextResponse.json({
    all_sources: allSources,
    matrix_source_category: allMatrix,
    channel_source: chanSource,
    non_115_distribution: non115,
    non_115_keyword_hits: samples,
    games_table: gamesInfo,
    candidate_game_tables: gamesApiTables,
    nonfilm_full_distribution: nonfilmAll,
  });
}
