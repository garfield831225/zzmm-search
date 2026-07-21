// 2026-07-21 临时: 查指定 id 在主 endpoint 真实状态
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const a = authAdmin(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const id = parseInt(req.nextUrl.searchParams.get('id') || '0', 10);
  if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const r = await sql`SELECT id, name, status, source, link IS NOT NULL as has_link, link_code IS NOT NULL as has_code, tmdb_id, matched_tmdb_at, created_at, updated_at FROM xx_resources WHERE id = ${id}`;
    const sub = await sql`SELECT id, source, url, status FROM xx_resource_links WHERE resource_id = ${id}`;
    return NextResponse.json({ found: r.length > 0, resource: r[0] || null, sub_links: sub });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
