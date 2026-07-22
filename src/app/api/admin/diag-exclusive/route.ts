// 临时 diag: exclusive_zone + resources + xx_resources 全部状态
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  // 1. exclusive_zone 表结构
  const exCols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'exclusive_zone' ORDER BY ordinal_position
  `;
  // 2. exclusive_zone 字段分布
  const exByCategory: any = {};
  for (const col of ['category', 'type', 'source', 'access_level', 'status']) {
    try {
      const r = await sql(`SELECT ${col}, COUNT(*) as c FROM exclusive_zone GROUP BY ${col} ORDER BY c DESC LIMIT 15`);
      exByCategory[col] = r;
    } catch { exByCategory[col] = 'err'; }
  }
  // 3. exclusive_zone 关键词命中
  const kw = ['VIP', '电子书', '有声', '小说', '精品课', '文档', 'PDF', '教程', '讲义', '音乐', 'FLAC', 'Hi-Res'];
  const exKw: any = {};
  for (const k of kw) {
    try {
      const r = await sql(`SELECT category, COUNT(*) as c FROM exclusive_zone WHERE name ILIKE '%${k}%' GROUP BY category ORDER BY c DESC`);
      if (r.length > 0) exKw[k] = r;
    } catch { /* skip */ }
  }
  const exSamples = await sql`SELECT * FROM exclusive_zone ORDER BY id LIMIT 3`;

  // 4. resources 表结构
  const rCols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'resources' ORDER BY ordinal_position
  `;
  const rByCategory: any = {};
  for (const col of ['category', 'type', 'source', 'access_level', 'status']) {
    try {
      const r = await sql(`SELECT ${col}, COUNT(*) as c FROM resources GROUP BY ${col} ORDER BY c DESC LIMIT 15`);
      rByCategory[col] = r;
    } catch { rByCategory[col] = 'err'; }
  }
  const rSamples = await sql`SELECT * FROM resources ORDER BY id LIMIT 3`;

  // 5. xx_resources 全部 status 分布
  const rStatus = await sql`SELECT status, COUNT(*) c FROM xx_resources GROUP BY status`;
  const rAccessLevelAll = await sql`SELECT access_level, COUNT(*) c FROM xx_resources GROUP BY access_level`;

  // 6. /docs 相关的 API 看是否用了别的表
  return NextResponse.json({
    exclusive_zone: {
      columns: exCols.map(c => `${c.column_name} (${c.data_type})`),
      by_field: exByCategory,
      keyword_hits: exKw,
      samples: exSamples,
    },
    resources: {
      columns: rCols.map(c => `${c.column_name} (${c.data_type})`),
      by_field: rByCategory,
      samples: rSamples,
    },
    xx_resources_status: rStatus,
    xx_resources_access_level_all: rAccessLevelAll,
  });
}
