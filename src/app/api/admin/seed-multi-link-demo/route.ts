// 2026-07-17: 一次性 diag - 给 5 个老资源加多网盘示例链接, 让用户看到 1对N 效果
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const r: any = {};

  // 选 5 个 zehe 资源 (有 TMDB 匹配的) 作为示例
  // 因为老数据每条只有 1 个 source, 我们给它加 4 个新 source 链接演示多网盘
  const candidates = await sql`
    SELECT r.id, r.name, r.category, r.import_channel
    FROM xx_resources r
    WHERE r.status = 'active' AND r.import_channel = 'zezemom_excel' AND r.tmdb_id IS NOT NULL
    ORDER BY r.id
    LIMIT 5
  ` as any[];

  if (candidates.length === 0) {
    return NextResponse.json({ error: 'no candidates found' });
  }

  const results: any[] = [];
  for (const c of candidates) {
    // 给每个资源加 4 个示例链接 (baidu / quark / magnet / aliyun)
    // 用假 URL + 假密码, 仅用于 demo
    const demoSources = [
      { source: 'baidu', url: `https://pan.baidu.com/s/demo_${c.id}_bd`, password: 'demo', sort: 2 },
      { source: 'quark', url: `https://pan.quark.cn/s/demo_${c.id}_qk`, password: 'demo', sort: 3 },
      { source: 'aliyun', url: `https://www.alipan.com/s/demo_${c.id}_al`, password: '', sort: 4 },
      { source: 'magnet', url: `magnet:?xt=urn:btih:demo${c.id.toString().padStart(20, '0')}abcdef`, password: '', sort: 10 },
    ];
    for (const s of demoSources) {
      try {
        await sql`
          INSERT INTO xx_resource_links (resource_id, source, url, password, sort, status, access_level)
          VALUES (${c.id}, ${s.source}, ${s.url}, ${s.password}, ${s.sort}, 'active', 'vip')
          ON CONFLICT (resource_id, source) DO UPDATE SET url = EXCLUDED.url, password = EXCLUDED.password, status = 'active'
        `;
      } catch (e: any) {
        results.push({ id: c.id, source: s.source, error: e.message?.slice(0, 100) });
      }
    }
    results.push({ id: c.id, name: c.name.slice(0, 30), added: 4 });
  }

  r.results = results;
  r.note = '示例已加, 刷新搜索页或详情页看效果 (会显示 baidu/quark/aliyun/magnet 图标排)';
  return NextResponse.json(r);
}
