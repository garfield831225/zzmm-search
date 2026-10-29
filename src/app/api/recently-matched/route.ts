// 2026-10-29 B4: 首页「🆕 刚匹配」专区 API
//
// 背景 (实测):
//   - 近 1 天新匹配资源 26307 条, 近 7 天 35371 条 / 4384 个 distinct tmdb_id
//   - 用户诉求: "让用户直接看到新匹配的内容"
//   - 但主列表排序是 sort_date (上映日期) → 刚匹配上的老资源排不进去
//   - 所以单独开一个专区, 按 matched_tmdb_at 倒序取最近匹配的
//
// 关键: 海报三源兜底 (跟 /api/search 一致)
//   cache_poster (不过期 JOIN, 过期行的海报还在) → resource_poster (资源自带) → tmdbMap
//
// 安全: 只返回有真 tmdb_id 的资源 (排除 NOMATCH/SKIP/GARBLED 哨兵值)

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

neonConfig.fetchConnectionCache = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(60, Math.max(1, parseInt(sp.get('limit') || '24') || 24));
    // 只看最近 N 天新匹配上的 (默认 7 天)
    const days = Math.min(30, Math.max(1, parseInt(sp.get('days') || '7') || 7));

    const rows = await sql`
      SELECT r.id, r.name, r.category, r.source, r.size, r.tmdb_id, r.tmdb_type,
             r.import_channel, r.access_level, r.pay_type, r.lumen_cost,
             r.matched_tmdb_at, r.created_at,
             NULLIF(c.poster_path, '') as cache_poster,
             NULLIF(r.poster, '') as resource_poster,
             NULLIF(c.release_date, '') as release_date,
             NULLIF(c.vote_average, '')::numeric as vote_average_num,
             c.title as tmdb_title,
             c.title_zh as tmdb_title_zh
      FROM xx_resources r
      LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
      WHERE r.status = 'active'
        AND r.matched_tmdb_at > NOW() - ${days} * INTERVAL '1 day'
        AND r.tmdb_id ~ '^[0-9]{1,10}$'
        AND r.tmdb_id::int > 10000
      ORDER BY r.matched_tmdb_at DESC, r.id DESC
      LIMIT ${limit}
    ` as any[];

    // 去重: 同一 tmdb_id 只留最新匹配的那条 (专区不需要重复剧集)
    const seen = new Set<string>();
    const items: any[] = [];
    for (const r of rows || []) {
      if (!r?.tmdb_id) continue;
      if (seen.has(r.tmdb_id)) continue;
      seen.add(r.tmdb_id);

      const poster = r.cache_poster || r.resource_poster || '';
      // 2026-10-29: release_date 可能是未来日期 (TMDB 给未上映/重映标的档期)
      //   实测: '魔发奇缘'(2010) = '2028-03-30' → 卡片显示 2028, 不对
      const rd = r.release_date || '';
      const today = new Date().toISOString().slice(0, 10);
      const releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(rd) && rd > today ? '' : rd;
      items.push({
        id: r.id,
        name: r.name || '',
        title: r.tmdb_title_zh || r.tmdb_title || r.name || '',
        tmdbId: r.tmdb_id,
        tmdbType: r.tmdb_type || 'movie',
        category: r.category || '',
        source: r.source || '',
        size: r.size || '',
        poster,
        releaseDate,
        voteAverage: r.vote_average_num != null ? parseFloat(String(r.vote_average_num)) : null,
        importChannel: r.import_channel || '',
        accessLevel: r.access_level || 'basic',
        payType: r.pay_type || 'free',
        lumenCost: r.lumen_cost ?? 1,
        matchedAt: r.matched_tmdb_at,
      });
    }

    return NextResponse.json({ items, count: items.length }, {
      headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error: any) {
    console.error('recently-matched error:', error.message);
    return NextResponse.json({ error: '查询失败: ' + error.message, items: [] }, { status: 500, headers: CORS_HEADERS });
  }
}
