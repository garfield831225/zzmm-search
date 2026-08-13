// 2026-08-13: 公共 API - 搜索联想 (moviezone + 子站调用)
//   GET /api/search/suggest?q=完美&limit=10
//   - 2026-08-13 改: 公开端点 (跟 /api/search /api/basic 一档), 不需 Bearer
//     - 理由: 搜索联想前端都是 keyup 即时调, 多一次 round-trip 鉴权浪费
//     - 安全: 只能读公开资源名 (xx_resources.name + xx_tmdb_cache.title_zh)
//     - 限速: 留给 moviezone BFF 层做 (IP-based 50 req/s)
//   - 简单 ILIKE 拿 TOP N 资源名
//   - 200ms 内响应
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

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
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '10')));

  if (!q || q.length < 1) {
    return NextResponse.json(
      { error: { code: 'missing_q', message: 'q 必填, 至少 1 字符' } },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (q.length > 50) {
    return NextResponse.json(
      { error: { code: 'q_too_long', message: 'q 不能超过 50 字符' } },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL || '');

    // 2026-08-13: 拿 TOP N 资源名 (去重) + TMDB 标题 (用 cache 拿)
    //   - xx_resources.name ILIKE 拿到该字段
    //   - xx_tmdb_cache.title_zh 优先 (更友好)
    //   - 合并去重, 按频率排序
    const rows = await sql`
      WITH q AS (SELECT ${'%' + q + '%'} as pattern)
      SELECT title, COUNT(*) as cnt FROM (
        -- 资源名 (frequency)
        SELECT r.name as title
        FROM xx_resources r, q
        WHERE r.status = 'active' AND r.name ILIKE q.pattern
        UNION ALL
        -- TMDB 标题 (zh 优先)
        SELECT t.title_zh as title
        FROM xx_tmdb_cache t, q
        WHERE t.title_zh IS NOT NULL AND t.title_zh ILIKE q.pattern
        UNION ALL
        SELECT t.title as title
        FROM xx_tmdb_cache t, q
        WHERE t.title IS NOT NULL AND t.title ILIKE q.pattern
      ) combined
      WHERE title IS NOT NULL AND title != ''
      GROUP BY title
      ORDER BY cnt DESC, LENGTH(title) ASC
      LIMIT ${limit}
    ` as any[];

    return NextResponse.json({
      q,
      suggestions: rows.map((r: any) => r.title).filter(Boolean),
    }, { headers: CORS_HEADERS });
  } catch (e: any) {
    console.error('[api/search/suggest] error:', e.message);
    return NextResponse.json(
      { error: { code: 'internal_error', message: e.message || '服务器错误' } },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
