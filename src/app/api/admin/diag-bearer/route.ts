// 临时 diag: 模拟 user 123123 (basic) 调 search API
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const u = await sql`SELECT id, username, user_group FROM xx_users WHERE username = '123123' LIMIT 1`;
  if (!u[0]) return NextResponse.json({ error: 'no user' });

  const token = jwt.sign({ id: u[0].id, group: u[0].user_group, username: u[0].username }, process.env.JWT_SECRET || 'cLWhs2015', { expiresIn: '1h' });

  const r = await fetch('https://zzmm-search.cc.cd/api/search?q=&pageSize=3', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  return NextResponse.json({
    user: u[0],
    search_status: r.status,
    search_total: data.total,
    search_items: data.items?.length || 0,
    first_item: data.items?.[0] ? { name: data.items[0].name, accessLevel: data.items[0].accessLevel, importChannel: data.items[0].importChannel, category: data.items[0].category } : null,
    error: data.error,
  });
}
