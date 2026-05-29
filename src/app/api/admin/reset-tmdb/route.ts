import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const key = req.headers.get('authorization')?.replace('Bearer ', '');
  if (key !== process.env.JWT_SECRET) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const body = await req.json().catch(() => ({}));
    const what = body.what || 'NOMATCH'; // 'NOMATCH', 'GARBLED', 'ALL'

    let count = 0;
    if (what === 'NOMATCH' || what === 'ALL') {
      const r = await sql`UPDATE xx_resources SET tmdb_id = NULL WHERE tmdb_id = 'NOMATCH' RETURNING id`;
      count += r.length;
    }
    if (what === 'GARBLED' || what === 'ALL') {
      const r = await sql`UPDATE xx_resources SET tmdb_id = NULL WHERE tmdb_id = 'GARBLED' RETURNING id`;
      count += r.length;
    }

    return NextResponse.json({ success: true, reset: count, what });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
