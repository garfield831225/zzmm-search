import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

// 批量修正分类：少儿频道/演唱会/REMUX/系列电影/连载
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key } = body;
    if (key !== 'tmdb-match-2026-secret-key-abc123') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    const results: any = {};

    // 少儿频道：少儿频道 sheet 的链接
    const childLinks = await sql`SELECT DISTINCT link FROM xx_resources WHERE link LIKE ${'%swfc5a836ah%'} AND category != '少儿频道'`.catch(() => []) as any[];
    if (childLinks.length) {
      const links = childLinks.map((r: any) => r.link);
      const res = await sql`UPDATE xx_resources SET category = '少儿频道', updated_at = NOW() WHERE link = ANY(${links}) RETURNING id`.catch(() => []) as any[];
      results['少儿频道'] = res.length;
    }

    // 演唱会
    const concertLinks = await sql`SELECT DISTINCT link FROM xx_resources WHERE link LIKE ${'%swfuxtv36ah%'} AND category != '演唱会'`.catch(() => []) as any[];
    if (concertLinks.length) {
      const links = concertLinks.map((r: any) => r.link);
      const res = await sql`UPDATE xx_resources SET category = '演唱会', updated_at = NOW() WHERE link = ANY(${links}) RETURNING id`.catch(() => []) as any[];
      results['演唱会'] = res.length;
    }

    // REMUX
    const remuxLinks = await sql`SELECT DISTINCT link FROM xx_resources WHERE link LIKE ${'%swf92os36ah%'} AND category != 'REMUX'`.catch(() => []) as any[];
    if (remuxLinks.length) {
      const links = remuxLinks.map((r: any) => r.link);
      const res = await sql`UPDATE xx_resources SET category = 'REMUX', updated_at = NOW() WHERE link = ANY(${links}) RETURNING id`.catch(() => []) as any[];
      results['REMUX'] = res.length;
    }

    // 系列电影
    const seriesRes = await sql`UPDATE xx_resources SET category = '系列电影', updated_at = NOW() WHERE name LIKE ${'%系列%'} AND category != '系列电影' RETURNING id`.catch(() => []) as any[];
    results['系列电影'] = seriesRes.length;

    // 连载
    const dailyLinks = await sql`SELECT DISTINCT link FROM xx_resources WHERE link LIKE ${'%115.com%'} AND link LIKE ${'%sw%'} AND name NOT LIKE ${'%iso%'} AND name NOT LIKE ${'%系列%'} AND category NOT IN ('少儿频道','演唱会','REMUX','系列电影','连载','电影','剧集','动漫','综艺','纪录片','原盘','音乐','体育') LIMIT 10000`.catch(() => []) as any[];
    if (dailyLinks.length) {
      const links = dailyLinks.map((r: any) => r.link);
      const res = await sql`UPDATE xx_resources SET category = '连载', updated_at = NOW() WHERE link = ANY(${links}) RETURNING id`.catch(() => []) as any[];
      results['连载'] = res.length;
    }

    // 返回各分类统计
    const cats = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources GROUP BY category ORDER BY cnt DESC`.catch(() => []) as any[];
    results['分类统计'] = cats;

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}