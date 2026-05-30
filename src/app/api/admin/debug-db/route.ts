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

    // 检查 O0Il 残留
    const o0ilPatterns = await sql`SELECT COUNT(*) as cnt FROM xx_resources WHERE link LIKE '%password=O0Il%' OR link_code = 'O0Il'`.catch(() => []) as any[];
    const o0ilSamples = await sql`SELECT id, name, link, link_code FROM xx_resources WHERE link LIKE '%password=O0Il%' OR link_code = 'O0Il' LIMIT 5`.catch(() => []) as any[];

    return NextResponse.json({
      categories: cats.map((r: any) => r.category),
      sources: srcs.map((r: any) => r.source),
      total: total[0]?.cnt,
      withTmdb: withTmdb[0]?.cnt,
      sample: sample,
      o0ilResidues: {
        count: o0ilPatterns[0]?.cnt,
        samples: o0ilSamples,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}