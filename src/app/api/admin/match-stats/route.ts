import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // Total active
    const total = (await sql(`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active'`)) as any[];
    // Matched: tmdb_id > 0 (integer, 0 = unmatched)
    const matched = (await sql(`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND tmdb_id IS NOT NULL AND CAST(tmdb_id AS INTEGER) > 0`)) as any[];
    // Unmatched: tmdb_id IS NULL or tmdb_id = 0 or tmdb_id is a string like NOMATCH/GARBLED
    const unmatched = (await sql(`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND (tmdb_id IS NULL OR CAST(tmdb_id AS INTEGER) = 0 OR CAST(tmdb_id AS TEXT) IN ('NOMATCH', 'GARBLED', ''))`)) as any[];
    // Unmatched with valid names (longer than 3 chars)
    const unmatchedValid = (await sql(`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND (tmdb_id IS NULL OR CAST(tmdb_id AS INTEGER) = 0 OR CAST(tmdb_id AS TEXT) IN ('NOMATCH', 'GARBLED', '')) AND LENGTH(name) > 3`)) as any[];

    return NextResponse.json({
      total: parseInt(total[0]?.cnt ?? '0'),
      matched: parseInt(matched[0]?.cnt ?? '0'),
      unmatched: parseInt(unmatched[0]?.cnt ?? '0'),
      unmatchedValid: parseInt(unmatchedValid[0]?.cnt ?? '0'),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}