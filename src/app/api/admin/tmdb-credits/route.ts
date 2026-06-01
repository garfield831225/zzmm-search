export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const TMDB_KEYS = (process.env.TMDB_API_KEYS || process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd').split(',');
const TMDB_BASE = 'https://api.themoviedb.org/3';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tmdbId = searchParams.get('tmdbId');
  const type = searchParams.get('type') || 'movie'; // movie | tv

  if (!tmdbId) return NextResponse.json({ error: '缺少 tmdbId' }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 先查缓存
    const cached = await sql`SELECT genres, overview, tagline, original_title, vote_count FROM xx_tmdb_cache WHERE tmdb_id = ${tmdbId}`;
    const cache = (cached || [])[0];

    // 拿 credits
    const keyIdx = Math.floor(Math.random() * TMDB_KEYS.length);
    await sleep(50);
    const credRes = await fetch(
      `${TMDB_BASE}/${type}/${tmdbId}/credits?api_key=${TMDB_KEYS[keyIdx]}&language=zh-CN`,
      { cache: 'no-store' }
    );
    const credData = credRes.ok ? await credRes.json() : { crew: [], cast: [] };

    const director = (credData.crew || [])
      .filter((p: any) => p.known_for_department === 'Directing' || p.job === 'Director')
      .slice(0, 5)
      .map((p: any) => ({
        name: p.name,
        character: p.job || '导演',
        profile_path: p.profile_path ? `https://image.tmdb.org/t/p/w200${p.profile_path}` : '',
        known_for_department: p.known_for_department,
      }));

    const cast = (credData.cast || [])
      .slice(0, 20)
      .map((p: any) => ({
        name: p.name,
        character: p.character || '',
        profile_path: p.profile_path ? `https://image.tmdb.org/t/p/w200${p.profile_path}` : '',
        known_for_department: p.known_for_department,
      }));

    // 解析 genres
    let genres: string[] = [];
    if (cache?.genres) {
      try { genres = JSON.parse(cache.genres); } catch {}
    }

    return NextResponse.json({
      director,
      cast,
      overview: cache?.overview || '',
      tagline: cache?.tagline || '',
      original_title: cache?.original_title || '',
      vote_count: cache?.vote_count || 0,
      genres,
    });
  } catch (error: any) {
    console.error('Credits error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
