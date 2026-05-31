import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'tmdb-match-2026-secret-key-abc123';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, action } = body;
    if (key !== JWT_SECRET) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    const results: any = {};

    // 诊断：查连载/其他/全量数据量
    if (action === 'debug') {
      const total = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources`.catch(() => [{cnt:0}]) as any[];
      const other = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE category = ${'其他'}`.catch(() => [{cnt:0}]) as any[];
      const lianzai = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE category = ${'连载'}`.catch(() => [{cnt:0}]) as any[];
      const linkSample = await sql`SELECT link, name, category FROM xx_resources WHERE category = ${'其他'} AND link LIKE ${'%115.com%'} AND name NOT LIKE ${'%iso%'} LIMIT 5`.catch(() => []) as any[];
      results['全量'] = total[0].cnt;
      results['其他'] = other[0].cnt;
      results['连载'] = lianzai[0].cnt;
      results['其他分类链接样本'] = linkSample;
      const cats = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources GROUP BY category ORDER BY cnt DESC`.catch(() => []) as any[];
      results['分类统计'] = cats;
      return NextResponse.json({ success: true, results });
    }

    // 少儿频道
    const childCnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE link LIKE ${'%swfc5a836ah%'}`.catch(() => [{cnt:0}]) as any[];
    results['少儿频道_现有'] = childCnt[0].cnt;
    const childUp = await sql`UPDATE xx_resources SET category = '少儿频道', updated_at = NOW() WHERE link LIKE ${'%swfc5a836ah%'} RETURNING id`.catch(() => []) as any[];
    results['少儿频道_已更新'] = childUp.length;

    // REMUX
    const remuxCnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE link LIKE ${'%swf92os36ah%'}`.catch(() => [{cnt:0}]) as any[];
    results['REMUX_现有'] = remuxCnt[0].cnt;
    const remuxUp = await sql`UPDATE xx_resources SET category = 'REMUX', updated_at = NOW() WHERE link LIKE ${'%swf92os36ah%'} RETURNING id`.catch(() => []) as any[];
    results['REMUX_已更新'] = remuxUp.length;

    // 分类统计
    const cats = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources GROUP BY category ORDER BY cnt DESC`.catch(() => []) as any[];
    results['分类统计'] = cats;

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}