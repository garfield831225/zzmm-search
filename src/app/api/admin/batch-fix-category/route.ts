import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'tmdb-match-2026-secret-key-abc123';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, action } = body;
    if (key !== JWT_SECRET) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    const results: any = {};

    // 分类统计
    const cats = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources GROUP BY category ORDER BY cnt DESC`.catch(() => []) as any[];
    results['分类统计'] = cats;

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}