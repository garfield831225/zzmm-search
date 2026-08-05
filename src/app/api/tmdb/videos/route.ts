// 2026-08-05: TMDB 最新预告片 / 视频 API
//   - 调 TMDB /trending/{type}/{window} 拿热门 + /movie/now_playing 拿影院上映中
//   - 每个 movie 调 /{type}/{id}/videos 拿 trailer
//   - 返 [{ id, title, videoKey, videoSite, backdrop, overview, type, releaseDate }]
//   - 前端用 videoKey 拼 YouTube embed iframe
//
// 数据流:
//   ?tab=trending  → /trending/movie/day + /trending/tv/day (默认)
//   ?tab=now_playing → /movie/now_playing + /tv/on_the_air
//   ?lang=zh-CN (默认) / en-US

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const CACHE_TTL_MS = 1000 * 60 * 10;  // 10 分钟缓存

interface VideoInfo {
  id: string;
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  originalTitle: string;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  backdrop: string;
  poster: string;
  videoKey: string;       // YouTube video key
  videoSite: string;      // YouTube / Vimeo
  videoName: string;      // trailer 名称
  videoType: string;      // Trailer / Teaser / Behind the Scenes
  videoOfficial: boolean;
}

// 模块级缓存 (同一 tab + lang 命中后 10 分钟内复用)
const cache = new Map<string, { at: number; data: VideoInfo[] }>();

async function tmdbGet(path: string, apiKey: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { cache: 'no-store' });
  if (!r.ok) {
    throw new Error(`TMDB ${path} ${r.status}: ${await r.text().catch(() => '')}`);
  }
  return r.json();
}

// 从一部 movie/tv 拿第一个 YouTube trailer/teaser
async function fetchVideo(type: 'movie' | 'tv', tmdbId: number, lang: string, apiKey: string): Promise<any | null> {
  try {
    // 优先 zh-CN 拿中文 trailer, fallback en-US
    let vids = await tmdbGet(`/${type}/${tmdbId}/videos`, apiKey, { language: lang });
    if (!vids?.results?.length && lang !== 'en-US') {
      vids = await tmdbGet(`/${type}/${tmdbId}/videos`, apiKey, { language: 'en-US' });
    }
    if (!vids?.results?.length) return null;
    // 优先 Trailer, 然后 Teaser, 然后任何 YouTube 视频
    const candidates = vids.results
      .filter((v: any) => v.site === 'YouTube' && v.key)
      .sort((a: any, b: any) => {
        const score = (v: any) => (v.type === 'Trailer' ? 3 : v.type === 'Teaser' ? 2 : 1) * (v.official ? 2 : 1);
        return score(b) - score(a);
      });
    return candidates[0] || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'TMDB_API_KEY not set' }, { status: 500 });
  }

  const sp = req.nextUrl.searchParams;
  const tab = sp.get('tab') || 'trending';  // trending | now_playing
  const lang = sp.get('lang') || 'zh-CN';
  const limit = Math.min(parseInt(sp.get('limit') || '12'), 20);

  const cacheKey = `${tab}:${lang}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, tab, lang, cached: true, items: cached.data });
  }

  try {
    // 1) 拿 trending/now_playing 列表 (混合 movie + tv)
    const listPromises: Promise<{ type: 'movie' | 'tv'; data: any }>[] = [];
    if (tab === 'now_playing') {
      listPromises.push(
        tmdbGet('/movie/now_playing', apiKey, { language: lang, page: '1', region: 'CN' })
          .then((data: any) => ({ type: 'movie' as const, data })),
        tmdbGet('/tv/on_the_air', apiKey, { language: lang, page: '1' })
          .then((data: any) => ({ type: 'tv' as const, data })),
      );
    } else {
      listPromises.push(
        tmdbGet('/trending/movie/day', apiKey, { language: lang })
          .then((data: any) => ({ type: 'movie' as const, data })),
        tmdbGet('/trending/tv/day', apiKey, { language: lang })
          .then((data: any) => ({ type: 'tv' as const, data })),
      );
    }
    const lists = await Promise.allSettled(listPromises);

    type Item = { type: 'movie' | 'tv'; id: number; title: string; originalTitle: string; overview: string; releaseDate: string; voteAverage: number; backdrop: string; poster: string };
    const candidates: Item[] = [];
    for (const l of lists) {
      if (l.status !== 'fulfilled') continue;
      const { type, data } = l.value;
      for (const r of (data.results || []).slice(0, 10)) {  // 每类取前 10
        candidates.push({
          type,
          id: r.id,
          title: r.title || r.name || '',
          originalTitle: r.original_title || r.original_name || '',
          overview: r.overview || '',
          releaseDate: r.release_date || r.first_air_date || '',
          voteAverage: r.vote_average || 0,
          backdrop: r.backdrop_path ? `${TMDB_IMG}/w780${r.backdrop_path}` : (r.poster_path ? `${TMDB_IMG}/w500${r.poster_path}` : ''),
          poster: r.poster_path ? `${TMDB_IMG}/w500${r.poster_path}` : '',
        });
      }
    }

    // 2) 每个候选并发拿 video, 限制并发 5
    const videos: VideoInfo[] = [];
    for (let i = 0; i < candidates.length; i += 5) {
      const batch = candidates.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(async (c) => {
          const v = await fetchVideo(c.type, c.id, lang, apiKey);
          if (!v) return null;
          return {
            id: `${c.type}-${c.id}`,
            type: c.type,
            tmdbId: c.id,
            title: c.title,
            originalTitle: c.originalTitle,
            overview: c.overview,
            releaseDate: c.releaseDate,
            voteAverage: c.voteAverage,
            backdrop: c.backdrop,
            poster: c.poster,
            videoKey: v.key,
            videoSite: v.site,
            videoName: v.name,
            videoType: v.type,
            videoOfficial: !!v.official,
          } as VideoInfo;
        })
      );
      for (const r of batchResults) if (r) videos.push(r);
      if (videos.length >= limit) break;
    }

    const items = videos.slice(0, limit);
    cache.set(cacheKey, { at: Date.now(), data: items });

    return NextResponse.json({ ok: true, tab, lang, cached: false, items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
