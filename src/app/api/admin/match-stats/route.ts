import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // Stats by bucket
    const buckets = await sql`
      SELECT 
        CASE 
          WHEN tmdb_id IS NULL THEN 'NULL'
          WHEN tmdb_id = '' THEN 'EMPTY'
          WHEN tmdb_id IN ('NOMATCH', 'GARBLED') THEN tmdb_id
          WHEN tmdb_id ~ '^[0-9]+$' AND (tmdb_id::bigint) > 0 THEN 'INTEGER_OK'
          WHEN tmdb_id ~ '^[0-9]+$' AND (tmdb_id::bigint) = 0 THEN 'INTEGER_ZERO'
          ELSE 'OTHER'
        END as bucket,
        COUNT(*) as cnt
      FROM xx_resources 
      WHERE status = 'active'
      GROUP BY bucket
      ORDER BY cnt DESC
    `;

    // Sample unmatched (tmdb_id = 0)
    const unmatchedSample = await sql`
      SELECT id, name, category, source, LEFT(link, 80) as link
      FROM xx_resources 
      WHERE status = 'active' AND tmdb_id ~ '^[0-9]+$' AND (tmdb_id::bigint) = 0
      ORDER BY updated_at DESC
      LIMIT 20
    `;

    // Sample other formats
    const otherSample = await sql`
      SELECT id, name, tmdb_id, category
      FROM xx_resources 
      WHERE status = 'active' AND tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH', 'GARBLED') AND tmdb_id !~ '^[0-9]+$'
      LIMIT 20
    `;

    // Category distribution of unmatched
    const categoryStats = await sql`
      SELECT category, COUNT(*) as cnt
      FROM xx_resources 
      WHERE status = 'active' AND tmdb_id ~ '^[0-9]+$' AND (tmdb_id::bigint) = 0
      GROUP BY category
      ORDER BY cnt DESC
    `;

    return NextResponse.json({ buckets, unmatchedSample, otherSample, categoryStats }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}