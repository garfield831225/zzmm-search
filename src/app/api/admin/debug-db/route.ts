import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // Get all unique categories and sources
    const cats = await sql`SELECT DISTINCT category FROM xx_resources ORDER BY category`.catch(() => []) as any[];
    const srcs = await sql`SELECT DISTINCT source FROM xx_resources ORDER BY source`.catch(() => []) as any[];
    const total = await sql`SELECT COUNT(*) as cnt FROM xx_resources`.catch(() => []) as any[];
    const withTmdb = await sql`SELECT COUNT(*) as cnt FROM xx_resources WHERE tmdb_id IS NOT NULL`.catch(() => []) as any[];
    const sample = await sql`SELECT name, category, source FROM xx_resources LIMIT 3`.catch(() => []) as any[];

    const o0ilResidues: { count: number; samples: any[] } = { count: 0, samples: [] };
    for (const code of ['O0Il', 'OolI', 'o0Il', 'oolI']) {
      const cnt = await sql`SELECT COUNT(*) as cnt FROM xx_resources WHERE link LIKE ${'%password=' + code + '%'} OR link_code = ${code}`.catch(() => []) as any[];
      const smpl = await sql`SELECT id, name, link, link_code FROM xx_resources WHERE link LIKE ${'%password=' + code + '%'} OR link_code = ${code} LIMIT 5`.catch(() => []) as any[];
      if (cnt[0]?.cnt > 0) {
        o0ilResidues.count += Number(cnt[0].cnt);
        o0ilResidues.samples.push(...smpl);
      }
    }

    // 查 Casper 电影（鬼马小精灵）的链接详情
    const casperRows = await sql`SELECT id, name, link, link_code, category FROM xx_resources WHERE name LIKE '%Casper%' OR name LIKE '%鬼马小精灵%' LIMIT 5`.catch(() => []) as any[];

    // 查所有含 OolI 提取码的记录（无论在 link 还是 link_code）
    const allO0ilByCode = await sql`SELECT id, name, link, link_code FROM xx_resources WHERE link_code = 'OolI' LIMIT 10`.catch(() => []) as any[];

    return NextResponse.json({
      categories: cats.map((r: any) => r.category),
      sources: srcs.map((r: any) => r.source),
      total: total[0]?.cnt,
      withTmdb: withTmdb[0]?.cnt,
      sample: sample,
      o0ilResidues: o0ilResidues,
      casper: casperRows,
      allO0ilByCode,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}