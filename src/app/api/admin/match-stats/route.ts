import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const total = await sql`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active'`;
    const matched = await sql`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND tmdb_id ~ '^[0-9]+$' AND (tmdb_id::bigint) > 0`;
    const nomatch = await sql`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id = 'NOMATCH' OR tmdb_id = 'GARBLED')`;
    const others = await sql`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH', 'GARBLED') AND tmdb_id !~ '^[0-9]+$'`;
    const otherSamples = await sql`SELECT tmdb_id, COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH', 'GARBLED') AND tmdb_id !~ '^[0-9]+$' GROUP BY tmdb_id ORDER BY cnt DESC LIMIT 20`;

    return NextResponse.json({
      total: parseInt(total[0]?.cnt ?? '0'),
      matched: parseInt(matched[0]?.cnt ?? '0'),
      nomatch: parseInt(nomatch[0]?.cnt ?? '0'),
      others: parseInt(others[0]?.cnt ?? '0'),
      otherSamples: otherSamples,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}