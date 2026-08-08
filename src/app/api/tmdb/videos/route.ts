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
export const maxDuration = 60;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.zzmm-search.uk/t/p';  // 2026-08-05 step 2: CF Worker 反代 (image.zzmm-search.uk)
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
// 2026-08-07: 缓存分 2 层 - listCache (trending/now_playing 列表 10 分钟) + cache (最终 items 30/60 分钟)
const listCache = new Map<string, { at: number; data: any[] }>();
const listCacheTTL = 1000 * 60 * 10;  // 10 分钟列表 cache (用于 stale fallback)

const cache = new Map<string, { at: number; data: VideoInfo[] }>();
const cacheTTL = new Map<string, number>();  // 2026-08-07: 按 tab 分 TTL
function getTTL(tab: string): number {
  if (tab === 'trending') return 1000 * 60 * 30;  // 30 分钟
  if (tab === 'now_playing') return 1000 * 60 * 60;  // 60 分钟
  return 1000 * 60 * 30;
}

async function tmdbGet(path: string, apiKey: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const urlStr = url.toString();
  // 2026-08-06: 5s timeout + retry 1 次 (NAS IP 偶尔被 TMDB 限流, 太快/太慢都不行)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(urlStr, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) {
        if (attempt === 2) {
          console.error(`[tmdbGet] ${path} status=${r.status} url=${urlStr.slice(0, 100)}`);
          throw new Error(`TMDB ${path} ${r.status}: ${await r.text().catch(() => '')}`);
        }
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      return r.json();
    } catch (e: any) {
      if (attempt === 2) {
        console.error(`[tmdbGet] ${path} failed: ${e.message?.slice(0, 100)} url=${urlStr.slice(0, 100)}`);
        throw e;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error('unreachable');
}

// 从一部 movie/tv 拿第一个 YouTube trailer/teaser
async function fetchVideo(type: 'movie' | 'tv', tmdbId: number, lang: string, apiKey: string): Promise<any | null> {
  try {
    // 优先 zh-CN 拿中文 trailer, fallback en-US
    let vids = await tmdbGet(`/${type}/${tmdbId}/videos`, apiKey, { language: lang });
    if (!vids?.results?.length && lang !== 'en-US') {
      vids = await tmdbGet(`/${type}/${tmdbId}/videos`, apiKey, { language: 'en-US' });
    }
    if (!vids?.results?.length) {
      console.warn(`[fetchVideo] ${type}/${tmdbId} no videos in any language`);
      return null;
    }
    // 优先 Trailer, 然后 Teaser, 然后任何 YouTube 视频
    const candidates = vids.results
      .filter((v: any) => v.site === 'YouTube' && v.key)
      .sort((a: any, b: any) => {
        const score = (v: any) => (v.type === 'Trailer' ? 3 : v.type === 'Teaser' ? 2 : 1) * (v.official ? 2 : 1);
        return score(b) - score(a);
      });
    if (candidates.length === 0) {
      console.warn(`[fetchVideo] ${type}/${tmdbId} has ${vids.results.length} videos but no YouTube`);
      return null;
    }
    return candidates[0];
  } catch (e: any) {
    console.error(`[fetchVideo] ${type}/${tmdbId} error: ${e.message?.slice(0, 100)}`);
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
  const limit = Math.min(parseInt(sp.get('limit') || '10'), 20);
  const fresh = sp.get('fresh') === '1';  // 2026-08-06: 跳过缓存, 强制重新拉 (用户切 tab 卡 0 条用)

  const cacheKey = `${tab}:${lang}:${limit}`;
  const cached = cache.get(cacheKey);
  if (!fresh && cached && Date.now() - cached.at < getTTL(tab)) {
    return NextResponse.json({ ok: true, tab, lang, cached: true, items: cached.data });
  }

  try {
    // 1) 拿 trending/now_playing 列表 (混合 movie + tv) - 用 listCache 限流时返 stale
    const listCacheKey = `list:${tab}:${lang}`;
    const listCached = listCache.get(listCacheKey);
    const listFresh = listCached && Date.now() - listCached.at < listCacheTTL;
    let candidates: any[] = [];
    if (!fresh && listFresh) {
      candidates = listCached!.data;
      console.log(`[listCache HIT] ${listCacheKey} ${candidates.length} items`);
    } else {
      const listPromises: Promise<{ type: 'movie' | 'tv'; data: any }>[] = [];
      if (tab === 'now_playing') {
        // 2026-08-06: region=CN 在 NAS IP 上返 0 条, 改 US (全球上映电影更多)
        listPromises.push(
          tmdbGet('/movie/now_playing', apiKey, { language: lang, page: '1', region: 'US' })
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
      const newCandidates: Item[] = [];
      for (const l of lists) {
        if (l.status !== 'fulfilled') continue;
        const { type, data } = l.value;
        for (const r of (data.results || []).slice(0, 10)) {  // 每类取前 10
          newCandidates.push({
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
      // 2026-08-07: 只缓存成功结果, 失败时用 stale fallback
      if (newCandidates.length > 0) {
        listCache.set(listCacheKey, { at: Date.now(), data: newCandidates });
      }
      candidates = newCandidates;
      // 限流时如果新 candidates 是空, 用 stale listCache (如果有)
      if (candidates.length === 0 && listCached) {
        console.log(`[listCache STALE FALLBACK] ${listCacheKey} ${listCached.data.length} items (限流中, 用上次数据)`);
        candidates = listCached.data;
      }
    }

    // 2) 每个候选并发拿 video, 限制并发 3 (避免 NAS IP 限流)
    const videos: VideoInfo[] = [];
    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3);
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
    console.log(`[GET /api/tmdb/videos] tab=${tab} candidates=${candidates.length} items=${videos.length}`);

    const items = videos.slice(0, limit);
    // 2026-08-07: 0 items 不删 cache (保留 stale), 限流时直接用老数据 fallback
    if (items.length > 0) {
      cache.set(cacheKey, { at: Date.now(), data: items });
    }

    // 2026-08-07: 限流时 (items=0) 尝试 stale cache fallback (不限 TTL, 内存里还有就用)
    if (items.length === 0 && cached) {
      console.log(`[cache STALE FALLBACK] ${cacheKey} ${cached.data.length} items (限流中, 用上次数据)`);
      return NextResponse.json({ ok: true, tab, lang, cached: 'stale', items: cached.data });
    }

    return NextResponse.json({ ok: true, tab, lang, cached: false, items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
