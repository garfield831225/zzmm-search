import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel Pro max 300s

const TMDB_KEY = process.env.TMDB_API_KEY || '7985342d5961e9ee3d5ef6d969c1b8dd';
const TMDB_BASE = 'https://api.themoviedb.org/3';

async function searchTmdb(type: string, name: string): Promise<string | null> {
  const url = `${TMDB_BASE}/search/${type}?api_key=${TMDB_KEY}&language=zh-CN&query=${encodeURIComponent(name)}&page=1&include_adult=false`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results && data.results.length > 0) return String(data.results[0].id);
  } catch {}
  return null;
}

async function cacheTmdb(tmdbId: string, type: string, sql: any) {
  const detailUrl = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=zh-CN`;
  try {
    const detailRes = await fetch(detailUrl, { next: { revalidate: 86400 } });
    if (!detailRes.ok) return;
    const d = await detailRes.json();
    await sql`
      INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, original_title, overview, poster_path, vote_average, vote_count, release_date, status, tagline, genres, cached_at)
      VALUES (
        ${tmdbId}, ${type}, ${d.title || d.name || ''}, ${d.original_title || d.original_name || ''},
        ${d.overview || ''}, ${d.poster_path ? 'https://image.tmdb.org/t/p/w500' + d.poster_path : null},
        ${d.vote_average || 0}, ${d.vote_count || 0}, ${d.release_date || d.first_air_date || null},
        ${d.status || null}, ${d.tagline || ''},
        ${d.genres ? d.genres.map((g: any) => g.name).join(',') : ''}, NOW()
      )
      ON CONFLICT (tmdb_id) DO UPDATE SET
        title = EXCLUDED.title, poster_path = EXCLUDED.poster_path,
        status = EXCLUDED.status, vote_average = EXCLUDED.vote_average,
        cached_at = NOW()
    `.catch(() => {});
  } catch {}
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const category = url.searchParams.get('category') || '';
  const batchSize = Math.min(200, Math.max(10, parseInt(url.searchParams.get('batchSize') || '100')));
  const skipCategories = (url.searchParams.get('skipCats') || '学习资料,音乐,纪录片,其他').split(',').filter(Boolean);

  if (key !== process.env.JWT_SECRET) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 获取未匹配的资源
    let params: any[] = [];
    let catFilter = '';
    if (category) {
      catFilter = ` AND r.category = $1`;
      params.push(category);
    }
    catFilter += ` AND r.category NOT IN (${skipCategories.map((_, i) => `$${params.length + i + 1}`).join(',')})`;
    params.push(...skipCategories);

    const rows = await sql(`
      SELECT r.id, r.name, r.category, r.source
      FROM xx_resources r
      WHERE r.tmdb_id IS NULL
        AND r.status = 'active'
        AND r.name IS NOT NULL
        AND LENGTH(r.name) > 2
        ${catFilter}
      LIMIT ${batchSize}
    `, params) as any[];

    if (!rows || rows.length === 0) {
      return NextResponse.json({ done: true, processed: 0, matched: 0, skipped: 0 });
    }

    let matched = 0;
    let skipped = 0;

    // 并发处理，每批 5 个请求（避免 TMDB rate limit）
    const BATCH_CONCURRENCY = 5;
    for (let i = 0; i < rows.length; i += BATCH_CONCURRENCY) {
      const batch = rows.slice(i, i + BATCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (row: any) => {
          const id = row.id;
          const name = row.name;
          const cat = row.category;
          const source = row.source;

          // 跳过非影视资源
          const skipWords = ['教程', '学习', '资料', '笔记', '课件', '讲义', '素材', '素材', '模板', '字体'];
          if (skipWords.some(w => name.includes(w))) return { id, matched: false };

          // 智能判断类型
          let type = 'movie';
          const tvKeywords = ['第', '季', '集', '部', '连续剧', '剧集'];
          const movieKeywords = ['电影'];
          if (tvKeywords.some(k => name.includes(k)) && !movieKeywords.some(k => name.includes(k))) {
            type = 'tv';
          } else if (cat === '剧集' || cat === '动漫' || cat === '综艺') {
            type = 'tv';
          }

          const tmdbId = await searchTmdb(type, name);
          if (tmdbId) {
            await sql`UPDATE xx_resources SET tmdb_id = ${tmdbId}, updated_at = NOW() WHERE id = ${id}`.catch(() => {});
            await cacheTmdb(tmdbId, type, sql);
            return { id, matched: true };
          }
          return { id, matched: false };
        })
      );

      results.forEach(r => {
        if (r.matched) matched++;
        else skipped++;
      });

      // 批次间暂停，防止 rate limit
      if (i + BATCH_CONCURRENCY < rows.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return NextResponse.json({
      processed: rows.length,
      matched,
      skipped,
      remaining: 'run again to continue',
      nextHint: `GET /api/admin/tmdb-match?key=${key}&batchSize=${batchSize}${category ? `&category=${category}` : ''}`
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}