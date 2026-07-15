// 临时 diag: 查 user + category counts
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');
  const u = await sql`SELECT id, username, user_group, expire_at FROM xx_users WHERE username = '123123' LIMIT 1`;
  const cats = ['体育', '音乐', '电子书', '精品课', '文档', '电影', '剧集', '动漫'];
  const counts: any = {};
  for (const cat of cats) {
    const r = await sql`SELECT COUNT(*) as c FROM xx_resources WHERE status='active' AND category = ${cat}`;
    counts[cat] = parseInt(r[0]?.c || '0');
  }
  return NextResponse.json({ user: u[0] || null, counts });
}
