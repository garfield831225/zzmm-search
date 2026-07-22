// 2026-07-18: diag - 模拟 admin 调 tg-json 测新代码入库
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sql = neon(process.env.DATABASE_URL || '');

  // 模拟 admin token
  const token = jwt.sign(
    { id: 1, username: 'admin', user_group: 'admin', group: 'admin', expire_at: null },
    process.env.JWT_SECRET || 'cLWhs2015',
    { expiresIn: '1d' }
  );

  // 准备测试数据
  const testMsgs = [
    {
      id: 900000001,
      type: 'message',
      text: '测试_baidu_9999',
      text_entities: [
        { type: 'text_link', text: 'baidu', href: 'https://pan.baidu.com/s/test9999unique?pwd=abcd' }
      ]
    },
    {
      id: 900000002,
      type: 'message',
      text: '测试_magnet_9999',
      text_entities: [
        { type: 'text_link', text: 'magnet', href: 'magnet:?xt=urn:btih:abc9999def9999abc9999def9999abc9999def99' }
      ]
    },
    {
      id: 900000003,
      type: 'message',
      text: '测试_混合_9999',
      text_entities: [
        { type: 'text_link', text: 'baidu', href: 'https://pan.baidu.com/s/mix9999unique?pwd=efgh' },
        { type: 'text_link', text: 'quark', href: 'https://pan.quark.cn/s/mix9999unique2' }
      ]
    }
  ];

  const r: any = {};

  // before count
  const before = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE name LIKE '测试_%'`;
  r.before = before[0]?.cnt;

  // 调 tg-json
  try {
    const res = await fetch('https://zzmm-search.cc.cd/api/admin/import/tg-json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        jsonContent: JSON.stringify({ messages: testMsgs })
      })
    });
    r.status = res.status;
    r.body = await res.json();
  } catch (e: any) {
    r.err = e.message;
  }

  // after count
  const after = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE name LIKE '测试_%'`;
  r.after = after[0]?.cnt;
  r.real_inserted = r.after - r.before;

  // 看副表
  const subs = await sql`SELECT r.id, r.name, r.source, r.link FROM xx_resources r WHERE r.name LIKE '测试_%' ORDER BY r.id`;
  r.test_resources = subs;
  if (subs[0]) {
    const links = await sql`SELECT resource_id, source, url FROM xx_resource_links WHERE resource_id = ANY(${subs.map((s: any) => s.id)}::int[])`;
    r.test_links = links;
  }

  return NextResponse.json(r);
}
