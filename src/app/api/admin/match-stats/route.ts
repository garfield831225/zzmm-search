import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const samples = await sql`
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

    return NextResponse.json({ buckets: samples }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}