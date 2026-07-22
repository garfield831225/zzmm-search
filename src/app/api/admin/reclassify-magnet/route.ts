// 2026-07-18: 重分类 "磁力" 资源 (detectCategoryByTitle 关键词库升级后, 老的没自动重分类)
// 端点:
//   ?key=&action=stats - 看多少条是"磁力"分类
//   ?key=&action=run&batch=5000 - 跑重分类 (按 id 范围, 用新版 detectCategoryByTitle)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { detectCategoryByTitle } from '@/lib/import-classifier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = 'zzmm-batch-test';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== KEY) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const action = req.nextUrl.searchParams.get('action') || 'stats';
  const r: any = { action };

  if (action === 'stats') {
    try {
      const cnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE category = '磁力'`;
      r.total = cnt[0]?.cnt;
    } catch (e: any) { r.err = e.message; }

    // sample
    try {
      const sample = await sql`SELECT id, name, category FROM xx_resources WHERE category = '磁力' ORDER BY id DESC LIMIT 5`;
      r.sample = sample;
    } catch {}

    return NextResponse.json(r);
  }

  if (action === 'run') {
    const batch = Math.min(parseInt(req.nextUrl.searchParams.get('batch') || '5000'), 5000);
    let totalReclassified = 0;
    let totalScanned = 0;
    const changes: Record<string, number> = {};

    try {
      // 取所有 category='磁力' 的资源
      const all = await sql`SELECT id, name, source FROM xx_resources WHERE category = '磁力' ORDER BY id ASC LIMIT ${batch}`;
      totalScanned = all.length;

      for (const row of all) {
        const newCat = detectCategoryByTitle(row.name, '磁力', row.source as any);
        if (newCat !== '磁力') {
          try {
            await sql`UPDATE xx_resources SET category = ${newCat} WHERE id = ${row.id}`;
            totalReclassified++;
            changes[newCat] = (changes[newCat] || 0) + 1;
          } catch (e) { /* skip */ }
        }
      }
    } catch (e: any) {
      return NextResponse.json({ action, error: e.message }, { status: 500 });
    }

    return NextResponse.json({
      action,
      scanned: totalScanned,
      reclassified: totalReclassified,
      changes,
    });
  }

  return NextResponse.json({ error: 'unknown action, use stats|run' }, { status: 400 });
}
