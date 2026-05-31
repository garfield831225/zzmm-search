import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_KEY = process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const MB_BASE = 'https://musicbrainz.org/ws/2';

interface TMDBResult {
  id: string;
  source: string;
  type: string;
  title: string;
  original_title: string;
  poster: string;
  year: string;
  vote: number;
  overview: string;
}

interface MBResult {
  id: string;
  source: string;
  type: string;
  title: string;
  artist: string;
  poster: string;
  year: string;
  vote: number;
  overview: string;
}

// 根据分类决定搜索源
function getSearchSource(category: string): string {
  if (['电影', '剧集', '动漫', '少儿频道', '综艺', '演唱会', '纪录片', '原盘', 'REMUX', '系列电影', '连载'].includes(category)) {
    return 'tmdb';
  }
  if (category === '音乐') return 'musicbrainz';
  return 'none';
}

async function searchTMDB(q: string, type: string, lang = 'zh-CN'): Promise<TMDBResult[]> {
  const endpoint = type === 'tv' ? '/search/tv' : '/search/movie';
  const url = `${TMDB_BASE}${endpoint}?api_key=${TMDB_KEY}&language=${lang}&query=${encodeURIComponent(q)}&page=1&include_adult=false`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data: { results?: any[] } = await res.json();
    return (data.results || []).slice(0, 10).map((r: any) => ({
      id: String(r.id),
      source: 'tmdb',
      type,
      title: r.title || r.name,
      original_title: r.original_title || r.original_name,
      poster: r.poster_path ? 'https://image.tmdb.org/t/p/w200' + r.poster_path : '',
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      vote: r.vote_average || 0,
      overview: r.overview || '',
    }));
  } catch {
    return [];
  }
}

async function searchMusicBrainz(q: string): Promise<MBResult[]> {
  const url = `${MB_BASE}/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=10`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ZZMM-Search/1.0 (contact@zzmm.cc)' },
      next: { revalidate: 3600 }
    });
    if (!res.ok) return [];
    const data: { recordings?: any[] } = await res.json();
    return (data.recordings || []).map((r: any) => {
      const rel = r.releases?.[0];
      return {
        id: r.id,
        source: 'musicbrainz',
        type: 'recording',
        title: r.title,
        artist: r['artist-credit']?.[0]?.name || '',
        poster: rel?.coverart?.thumb250 || '',
        year: rel?.date?.slice(0, 4) || '',
        vote: 0,
        overview: '',
      };
    });
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const type = searchParams.get('type') || 'movie';

  if (!q.trim()) return NextResponse.json({ results: [] });

  const source = getSearchSource(category);

  if (source === 'tmdb') {
    const results = await searchTMDB(q, type === 'tv' ? 'tv' : 'movie');
    return NextResponse.json({ results, source: 'tmdb' });
  }

  if (source === 'musicbrainz') {
    const results = await searchMusicBrainz(q);
    return NextResponse.json({ results, source: 'musicbrainz' });
  }

  return NextResponse.json({ results: [], source: 'none' });
}