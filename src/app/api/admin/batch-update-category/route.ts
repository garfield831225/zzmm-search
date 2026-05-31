import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 批量更新资源的分类
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { links, category } = body;
    if (!links || !Array.isArray(links) || !category) {
      return NextResponse.json({ error: '缺少 links 或 category' }, { status: 400 });
    }
    const sql = neon(process.env.DATABASE_URL || '');
    const result = await sql`UPDATE xx_resources SET category = ${category}, updated_at = NOW() WHERE link = ANY(${links}) RETURNING id`;
    return NextResponse.json({ success: true, updated: result.length || 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}