// 2026-08-03: P5.1 主题专区 API (公开)
//   - 列出所有 active 主题 (按 sort_order 升序)
//   - 每个主题包含 items[] 卡片数据 (按 sort_order 升序)
//   - JOIN xx_tmdb_cache 拿最新 poster + overview
//   - DISTINCT 防重复

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '', {
    fetchOptions: { cache: 'no-store' },
  });

  try {
    // 拿所有 active 主题 (按 sort_order 升序)
    const themes = await sql`
      SELECT id, name, slug, sort_order, created_at
      FROM xx_themes
      WHERE status = 'active'
      ORDER BY sort_order ASC, id ASC
    `;

    // 拿所有 active items (按 theme_id 分组)
    const items = await sql`
      SELECT
        ti.id, ti.theme_id, ti.tmdb_id, ti.tmdb_type, ti.title,
        ti.poster_path, ti.backdrop_path, ti.sort_order,
        t.title_zh, t.original_title, t.release_date, t.vote_average, t.overview
      FROM xx_theme_items ti
      LEFT JOIN xx_tmdb_cache t ON t.tmdb_id::text = ti.tmdb_id::text
      WHERE ti.status = 'active'
      ORDER BY ti.theme_id ASC, ti.sort_order ASC, ti.id ASC
    `;

    // 按 theme_id 分组
    const itemsByTheme: Record<number, any[]> = {};
    for (const it of items as any[]) {
      if (!itemsByTheme[it.theme_id]) itemsByTheme[it.theme_id] = [];
      itemsByTheme[it.theme_id].push({
        itemId: it.id,
        tmdbId: it.tmdb_id,
        tmdbType: it.tmdb_type,
        title: it.title || it.title_zh,
        originalTitle: it.original_title,
        releaseDate: it.release_date,
        posterPath: it.poster_path,
        posterUrl: it.poster_path ? `${TMDB_IMAGE_BASE}${it.poster_path}` : null,
        backdropUrl: it.backdrop_path ? `${TMDB_IMAGE_BASE}${it.backdrop_path}` : null,
        voteAverage: it.vote_average ? parseFloat(it.vote_average) : null,
        overview: it.overview,
        sortOrder: it.sort_order,
      });
    }

    const data = themes.map((t: any) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      sortOrder: t.sort_order,
      createdAt: t.created_at,
      items: itemsByTheme[t.id] || [],
    }));

    return NextResponse.json({
      total: data.length,
      themes: data,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
