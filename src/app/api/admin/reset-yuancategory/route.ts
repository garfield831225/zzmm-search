import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const body = await req.json().catch(() => ({}));
  const key = body.key;
  if (key !== '5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // 重置所有 category=原盘 且已匹配的资源的 tmdb_id
    const r = await sql`
      UPDATE xx_resources
      SET tmdb_id = NULL, updated_at = NOW()
      WHERE category = '原盘' AND tmdb_id IS NOT NULL AND tmdb_id != ''
      RETURNING id
    `.catch(() => []) as any[];

    return NextResponse.json({ success: true, reset: r.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}