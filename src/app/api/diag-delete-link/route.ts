// 2026-07-17: diag - 直接调 admin/links DELETE 看服务端返回
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // 模拟 admin token (id=1, group=admin)
  const token = jwt.sign(
    { id: 1, username: 'admin', user_group: 'admin', group: 'admin', expire_at: null },
    process.env.JWT_SECRET || 'cLWhs2015',
    { expiresIn: '1d' }
  );

  const sql = neon(process.env.DATABASE_URL || '');

  // 拿一个 1 link 的资源测试删除
  const sample = await sql`SELECT id, source, link FROM xx_resource_links WHERE status = 'active' ORDER BY resource_id DESC LIMIT 1` as any[];

  if (!sample[0]) return NextResponse.json({ error: 'no sample link' });

  const r: any = { sample: sample[0], token: token.slice(0, 20) + '...' };

  // 模拟前端调用
  try {
    const res = await fetch('https://zzmm-search.cc.cd/api/admin/links', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ resourceId: sample[0].resource_id, source: sample[0].source })
    });
    r.fetch_status = res.status;
    r.fetch_body = await res.text();
  } catch (e: any) {
    r.fetch_err = e.message;
  }

  return NextResponse.json(r);
}
