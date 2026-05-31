import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const key = request.nextUrl.searchParams.get('key');
    if (key !== 'tmdb-match-2026-secret-key-abc123') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    // Get all unique categories and counts
    const cats = await sql`SELECT category, COUNT(*) as cnt FROM xx_resources GROUP BY category ORDER BY cnt DESC`.catch(() => []) as any[];
    const srcs = await sql`SELECT DISTINCT source FROM xx_resources ORDER BY source`.catch(() => []) as any[];
    const total = await sql`SELECT COUNT(*) as cnt FROM xx_resources`.catch(() => []) as any[];
    const withTmdb = await sql`SELECT COUNT(*) as cnt FROM xx_resources WHERE tmdb_id IS NOT NULL`.catch(() => []) as any[];
    const sample = await sql`SELECT name, category, source FROM xx_resources LIMIT 3`.catch(() => []) as any[];

    const o0ilResidues: { count: number; samples: any[] } = { count: 0, samples: [] };
    // 用 sql() 绕过 Neon 模板标签的占位符限制，直接传完整字符串
    const allResidues = await sql(`SELECT id, name, link, link_code FROM xx_resources WHERE link LIKE '%password=%' AND (link LIKE '%password=O0Il%' OR link LIKE '%password=OolI%' OR link LIKE '%password=o0Il%' OR link LIKE '%password=oolI%') LIMIT 20`).catch(() => []) as any[];
    o0ilResidues.count = allResidues.length;
    o0ilResidues.samples = allResidues;

    // 查 Casper 电影（鬼马小精灵）的链接详情
    const casperRows = await sql`SELECT id, name, link, link_code, category FROM xx_resources WHERE name LIKE '%Casper%' OR name LIKE '%鬼马小精灵%' LIMIT 5`.catch(() => []) as any[];

    // 查所有含 OolI 提取码的记录（无论在 link 还是 link_code）
    const allO0ilByCode = await sql`SELECT id, name, link, link_code FROM xx_resources WHERE link_code = 'OolI' LIMIT 10`.catch(() => []) as any[];

    return NextResponse.json({
      categories: cats.map((r: any) => ({ name: r.category, count: r.cnt })),
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