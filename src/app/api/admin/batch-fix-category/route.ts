import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

// 精准批量修正分类
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key } = body;
    if (key !== 'tmdb-match-2026-secret-key-abc123') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    const results: any = {};

    // 少儿频道：19条，链接含 swfc5a836ah
    const child = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE link LIKE '%swfc5a836ah%'`.catch(() => [{cnt:0}]) as any[];
    if (child[0].cnt > 0) {
      const up = await sql`UPDATE xx_resources SET category = '少儿频道', updated_at = NOW() WHERE link LIKE '%swfc5a836ah%' RETURNING id`.catch(() => []) as any[];
      results['少儿频道'] = up.length;
    }

    // REMUX：8条，链接含 swf92os36ah
    const remux = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE link LIKE '%swf92os36ah%'`.catch(() => [{cnt:0}]) as any[];
    if (remux[0].cnt > 0) {
      const up = await sql`UPDATE xx_resources SET category = 'REMUX', updated_at = NOW() WHERE link LIKE '%swf92os36ah%' RETURNING id`.catch(() => []) as any[];
      results['REMUX'] = up.length;
    }

    // 连载：从"其他"分类里找非原盘iso文件的115链接，且不在其他已知分类
    // 策略：link含115.com，不含115cdn.com（区别于原盘），name不含iso，且category是其他
    const dailyUp = await sql`UPDATE xx_resources SET category = '连载', updated_at = NOW() WHERE link LIKE '%115.com%' AND link NOT LIKE '%115cdn.com%' AND name NOT LIKE '%iso%' AND category = '其他' RETURNING id`.catch(() => []) as any[];
    results['连载_从其他修正'] = dailyUp.length;

    // 返回各分类统计
    const cats = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources GROUP BY category ORDER BY cnt DESC`.catch(() => []) as any[];
    results['分类统计'] = cats;

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}