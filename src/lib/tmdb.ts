export const TMDB_KEY = process.env.TMDB_API_KEY || '7985342d5961e9ee3d5ef6d969c1b8dd';
export const TMDB_BASE = 'https://api.tmdb.org/3';
export const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

export async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', TMDB_KEY);
  url.searchParams.set('language', 'zh-CN');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
  if (!res.ok) return null;
  return res.json();
}
