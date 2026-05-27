import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // Total active
    const total = (await sql(`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active'`)) as any[];
    // Matched
    const matched = (await sql(`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND tmdb_id IS NOT NULL AND tmdb_id != ''`)) as any[];
    // Unmatched (no tmdb_id)
    const unmatched = (await sql(`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND (tmdb_id IS NULL OR tmdb_id = '')`)) as any[];
    // Unmatched with valid names (longer than 3 chars)
    const unmatchedValid = (await sql(`SELECT COUNT(*) as cnt FROM xx_resources WHERE status = 'active' AND (tmdb_id IS NULL OR tmdb_id = '') AND LENGTH(name) > 3`)) as any[];

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