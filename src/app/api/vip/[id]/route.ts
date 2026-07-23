// 2026-07-24 zzmm-vip 影视区 - 单个资源详情 API
// 返回: TMDB 详情 + 该资源所有可用播放链接 (按集数分组)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';
const ALLOWED = new Set(['basic', 'vip', 'admin']);

function getGroup(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ')
    ? auth.replace('Bearer ', '')
    : req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return payload?.group || null;
  } catch {
    return null;
  }
}

const TMDB_IMG = 'https://image.tmdb.org/t/p';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const group = getGroup(req);
  if (!group || !ALLOWED.has(group)) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (!id || isNaN(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL || '');

    const rows = await sql`SELECT
        r.*,
        l.id AS link_id, l.play_url, l.source AS link_source, l.status AS link_status,
        l.season, l.episode, l.episode_title, l.last_ok_at
      FROM xx_vip_resources r
      LEFT JOIN xx_vip_links l ON l.resource_id = r.id
      WHERE r.id = ${id}
      ORDER BY l.season NULLS FIRST, l.episode NULLS FIRST, l.id ASC`;

    if (!rows.length) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const head = rows[0] as any;
    const links = rows
      .filter((r) => r.link_id)
      .map((r) => ({
        id: Number(r.link_id),
        source: r.link_source,
        status: r.link_status,
        season: r.season ? Number(r.season) : null,
        episode: r.episode ? Number(r.episode) : null,
        episodeTitle: r.episode_title,
        playUrl: r.play_url,
        lastOkAt: r.last_ok_at,
      }));

    return NextResponse.json({
      ok: true,
      resource: {
        id: Number(head.id),
        tmdbId: Number(head.tmdb_id),
        mediaType: head.media_type,
        title: head.title,
        originalTitle: head.original_title,
        originalLanguage: head.original_language,
        overview: head.overview,
        posterUrl: head.poster_path ? `${TMDB_IMG}/w500${head.poster_path}` : null,
        backdropUrl: head.backdrop_path ? `${TMDB_IMG}/w1280${head.backdrop_path}` : null,
        voteAverage: head.vote_average ? Number(head.vote_average) : null,
        voteCount: head.vote_count ? Number(head.vote_count) : 0,
        releaseDate: head.release_date || head.first_air_date || null,
        popularity: head.popularity ? Number(head.popularity) : 0,
        genreIds: head.genre_ids || [],
        seasonCount: head.season_count ? Number(head.season_count) : null,
        episodeCount: head.episode_count ? Number(head.episode_count) : null,
        status: head.status,
        lastEpisodeToAir: head.last_episode_to_air,
        nextEpisodeToAir: head.next_episode_to_air,
        runtime: head.runtime ? Number(head.runtime) : null,
        adult: !!head.adult,
      },
      links,
      hasLinks: links.length > 0,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '查询失败' }, { status: 500 });
  }
}
