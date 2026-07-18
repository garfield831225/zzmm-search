// 临时 diag: 用 server JWT_SECRET 签 admin token, 调 search API 看实际返什么
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  // 用 admin 身份签 token
  const token = jwt.sign({ id: 1, group: 'admin', username: 'admin' }, process.env.JWT_SECRET || 'cLWhs2015', { expiresIn: '1h' });

  // 模拟 VIP 区 + magnet
  const r = await fetch('https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&page=1&pageSize=3&sort=import_time_asc&debug=1', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();

  // 直查 vip magnet 总数
  const cnt = await sql`SELECT COUNT(*) as c FROM xx_resources WHERE status='active' AND source='magnet' AND (import_channel IS NULL OR import_channel != 'zezemom_excel') AND pay_type != 'code'`;

  return NextResponse.json({
    admin_token_used: token.slice(0, 40) + '...',
    search_total: data.total,
    search_items: data.items?.length || 0,
    first_item: data.items?.[0] ? { id: data.items[0].id, name: data.items[0].name?.slice(0, 30), source: data.items[0].source, cat: data.items[0].category, access: data.items[0].accessLevel, ch: data.items[0].importChannel } : null,
    db_vip_magnet_count: cnt[0].c,
    error: data.error,
  });
}
