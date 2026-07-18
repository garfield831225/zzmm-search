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
  const r1 = await fetch('https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&page=1&pageSize=3&sort=import_time_asc&debug=1', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const debugData = await r1.json();

  // 真实查询不带 debug
  const r = await fetch('https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&page=1&pageSize=3&sort=import_time_asc', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();

  // 用真实 server token 调 debug2 看实际 count SQL
  const r2 = await fetch('https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&debug2=1', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const debug2 = await r2.json();

  // 直查 vip magnet 总数 (用相同 whereClause 模拟 search API)
  // search API 用的: `sql\`SELECT COUNT(*) as cnt FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE ${whereClause}\``
  const fullWhere = `r.status = 'active' AND 1=1 AND r.source = 'magnet' AND 1=1 AND 1=1 AND 1=1 AND (r.access_level IN ('basic', 'vip', 'code')) AND 1=1 AND 1=1 AND ((r.import_channel IS NULL OR r.import_channel != 'zezemom_excel') AND (r.pay_type IS NULL OR r.pay_type != 'code'))`;
  // 1. 模拟 search API count: LEFT JOIN
  const cnt = await sql(`SELECT COUNT(*) as c FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE ${fullWhere}`);
  // 2. 不用 JOIN
  const cnt3 = await sql(`SELECT COUNT(*) as c FROM xx_resources r WHERE r.status = 'active' AND r.source = 'magnet' AND (r.access_level IN ('basic', 'vip', 'code'))`);
  // 3. 查这 2 条 (id 377353 + 542863) 真实 source/cat
  const samples = await sql(`SELECT id, name, source, category, pay_type, access_level, import_channel, status FROM xx_resources WHERE id IN (377353, 542863)`);
  // 4. 查总数 (active + source=magnet)
  const cnt4 = await sql(`SELECT COUNT(*) as c FROM xx_resources WHERE status='active' AND source='magnet'`);
  // 5. 完整表 status 分布
  const statusDist = await sql`SELECT status, COUNT(*) as c FROM xx_resources GROUP BY status`;
  // 6. 实际用 search API 的 fetch SQL (但用 template tag 包装) - 完全模拟 search API count
  const countFromApi = await sql`SELECT COUNT(*) as cnt FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE r.status = 'active' AND 1=1 AND r.source = 'magnet' AND 1=1 AND 1=1 AND 1=1 AND (r.access_level IN ('basic', 'vip', 'code')) AND 1=1 AND 1=1 AND ((r.import_channel IS NULL OR r.import_channel != 'zezemom_excel') AND (r.pay_type IS NULL OR r.pay_type != 'code'))`;

  return NextResponse.json({
    admin_token_used: token.slice(0, 40) + '...',
    search_total: data.total,
    search_items: data.items?.length || 0,
    first_item: data.items?.[0] ? { id: data.items[0].id, name: data.items[0].name?.slice(0, 30), source: data.items[0].source, cat: data.items[0].category, access: data.items[0].accessLevel, ch: data.items[0].importChannel } : null,
    db_vip_magnet_with_join: cnt[0].c,
    db_vip_magnet_no_join: cnt3[0].c,
    db_vip_magnet_templatetag: countFromApi[0].cnt,
    db_total_active_magnet: cnt4[0].c,
    status_dist: statusDist,
    samples: samples,
    error: data.error,
    debug: debugData,
    debug2,
  });
}
