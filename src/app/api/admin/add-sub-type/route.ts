import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

// 从 name 推断 sub_type 分类
function inferSubType(name: string): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/演唱会|演奏会|音乐会|live|concert/i.test(name)) return '演唱会';
  if (/4k原盘|4k蓝光/i.test(name)) return '电影';
  if (/3d原盘|3d蓝光/i.test(name)) return '3D原盘';
  if (/动画电影|动漫电影|卡通电影/i.test(name)) return '动画电影';
  if (/第.*季|s\d{1,2}|-season\s*\d/i.test(name)) return '剧集';
  if (/remux|blu-?ray|bdmv|4k|uhd|原盘|蓝光/i.test(n)) return '电影';
  return null;
}

export async function POST(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const body = await req.json().catch(() => ({}));
  const key = body.key;
  if (key !== '5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // 1. 检查 column 是否存在
    const colCheck = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'xx_resources' AND column_name = 'sub_type'
    `.catch(() => []);

    if (!colCheck || colCheck.length === 0) {
      await sql`ALTER TABLE xx_resources ADD COLUMN sub_type text DEFAULT NULL`.catch(() => {});
    }

    // 2. 批量回填：一次查出所有待更新记录
    const rows = await sql`
      SELECT id, name FROM xx_resources
      WHERE (sub_type IS NULL OR sub_type = '')
        AND category IN ('原盘', '4K原盘')
      LIMIT 5000
    `.catch(() => []) as any[];

    // 按 id 分组，每 200 条批量更新一次
    const BATCH = 200;
    let updated = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const updates = batch
        .map(r => { const t = inferSubType(r.name || ''); return t ? { id: r.id, subType: t } : null; })
        .filter(Boolean) as { id: number; subType: string }[];

      if (updates.length === 0) continue;

      // 构造批量 UPDATE
      const setClauses = updates.map(u => `WHEN ${u.id} THEN '${u.subType.replace(/'/g, "''")}'`).join(' ');
      const ids = updates.map(u => u.id);
      const sqlStr = `UPDATE xx_resources SET sub_type = CASE id ${setClauses} END WHERE id = ANY($1::int[])`;
      await sql(`${sqlStr}` as any, [ids]).catch(() => {});
      updated += updates.length;
    }

    // 3. 统计
    const stats = await sql`
      SELECT sub_type, COUNT(*)::int as cnt FROM xx_resources
      WHERE category IN ('原盘', '4K原盘') AND sub_type IS NOT NULL AND sub_type != ''
      GROUP BY sub_type
    `.catch(() => []) as any[];

    return NextResponse.json({ success: true, updated, stats });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
