import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, any> = {};
  const TMDB_KEY = '7985342d5961e9ee3d5ef6d969c1b8dd';
  const TMDB_BASE = 'https://api.themoviedb.org/3';

  // Test TMDB with multiple query variants
  const tests = [
    { label: '肖申克', q: '肖申克' },
    { label: '肖申克的救赎', q: '肖申克的救赎' },
    { label: '流浪地球', q: '流浪地球' },
    { label: 'Avatar', q: 'Avatar' },
    { label: '狂飙', q: '狂飙' },
  ];

  for (const t of tests) {
    try {
      const r = await fetch(
        `${TMDB_BASE}/search/movie?api_key=${TMDB_KEY}&language=zh-CN&query=${encodeURIComponent(t.q)}&page=1&include_adult=false`,
        { next: { revalidate: 0 } }
      );
      const data = await r.json();
      results[t.label] = { ok: r.ok, status: r.status, count: data.results?.length, top: data.results?.[0]?.title };
    } catch (e: any) {
      results[t.label] = { error: e.message };
    }
  }

  return NextResponse.json(results);
}