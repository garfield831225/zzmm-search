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

    // 少儿频道：19条
    const childCnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE link LIKE ${'%swfc5a836ah%'}`.catch(() => [{cnt:0}]) as any[];
    results['少儿频道_现有数量'] = childCnt[0].cnt;
    const childUp = await sql`UPDATE xx_resources SET category = '少儿频道', updated_at = NOW() WHERE link LIKE ${'%swfc5a836ah%'} RETURNING id`.catch(() => []) as any[];
    results['少儿频道_已更新'] = childUp.length;

    // REMUX：8条
    const remuxCnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE link LIKE ${'%swf92os36ah%'}`.catch(() => [{cnt:0}]) as any[];
    results['REMUX_现有数量'] = remuxCnt[0].cnt;
    const remuxUp = await sql`UPDATE xx_resources SET category = 'REMUX', updated_at = NOW() WHERE link LIKE ${'%swf92os36ah%'} RETURNING id`.catch(() => []) as any[];
    results['REMUX_已更新'] = remuxUp.length;

    // 连载：从"其他"分类里找 115.com 链接（非115cdn，非iso）
    const dailyCnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE link LIKE ${'%115.com%'} AND link NOT LIKE ${'%115cdn.com%'} AND name NOT LIKE ${'%iso%'} AND category = ${'其他'}`.catch(() => [{cnt:0}]) as any[];
    results['连载_待更新数量'] = dailyCnt[0].cnt;
    const dailyUp = await sql`UPDATE xx_resources SET category = '连载', updated_at = NOW() WHERE link LIKE ${'%115.com%'} AND link NOT LIKE ${'%115cdn.com%'} AND name NOT LIKE ${'%iso%'} AND category = ${'其他'} RETURNING id`.catch(() => []) as any[];
    results['连载_已更新'] = dailyUp.length;

    // 最终分类统计（强制最新）
    const cats = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources GROUP BY category ORDER BY cnt DESC`.catch(() => []) as any[];
    results['分类统计'] = cats;

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}