// 2026-08-14: 公共 API - 追剧日历 (SIMKL + TVMaze 合并)
//   GET /api/calendar?start=2026-08-14&days=30&type=tv
//   - SIMKL: 公共日历 (X-Simkl-Api-Key: client_id, v1 格式)
//   - TVMaze: 完全免费公共日程 (schedule/web?date=YYYY-MM-DD)
//   - 合并: 同一 tmdb_id 去重
//   - 缓存 1 天 (用户原话 1d)
//   - 关联 xx_resources: 返 localResourceCount
// 2026-08-14: 公共 API, CORS * (moviezone/子站能调)
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 1 天

const SIMKL_API_BASE = process.env.SIMKL_API_BASE || 'https://api.simkl.com';
const SIMKL_CLIENT_ID = process.env.SIMKL_CLIENT_ID || '';
const TVMAZE_API_BASE = 'https://api.tvmaze.com';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface CalendarItem {
  id: string;            // 唯一 ID (simkl:sim-{id} | tvmaze:{id})
  source: 'simkl' | 'tvmaze';
  tmdbId: string | null;
  tvdbId: string | null;
  title: string;
  type: 'tv' | 'movie' | 'anime';
  airDate: string;        // YYYY-MM-DD
  airTime: string | null; // HH:MM UTC
  episode: { season: number; number: number; title: string | null } | null;
  overview: string | null;
  poster: string | null;
  // 关联 xx_resources
  localResourceCount?: number;
  localSources?: string[];
}

async function fetchSimkl(start: string, days: number): Promise<CalendarItem[]> {
  if (!SIMKL_CLIENT_ID) return [];
  const url = `${SIMKL_API_BASE}/calendar/all?type=tv&start=${start}&days=${days}&extended=overview`;
  try {
    const r = await fetch(url, {
      headers: {
        'X-Simkl-Api-Key': SIMKL_CLIENT_ID,
        'Accept': 'application/json',
        'simkl-api-key': SIMKL_CLIENT_ID,
      },
      cache: 'no-store',
    });
    if (!r.ok) {
      console.warn(`[calendar] SIMKL ${r.status}`);
      return [];
    }
    const data = await r.json();
    const items: CalendarItem[] = [];
    // SIMKL 公共日历格式: [{ date, episodes: [{ show, episode }] }]
    for (const dayEntry of (data || [])) {
      for (const ep of (dayEntry.episodes || [])) {
        const show = ep.show || {};
        items.push({
          id: `sim-${show.ids?.simkl || show.ids?.tmdb || show.title || Math.random()}`,
          source: 'simkl',
          tmdbId: show.ids?.tmdb ? String(show.ids.tmdb) : null,
          tvdbId: show.ids?.tvdb ? String(show.ids.tvdb) : null,
          title: show.title || '',
          type: 'tv',
          airDate: dayEntry.date || start,
          airTime: ep.runtime ? String(ep.runtime).slice(0, 5) : null,
          episode: ep.season && ep.number ? {
            season: ep.season,
            number: ep.number,
            title: ep.title || null,
          } : null,
          overview: ep.overview || show.overview || null,
          poster: show.poster || null,
        });
      }
    }
    return items;
  } catch (e: any) {
    console.warn('[calendar] SIMKL failed:', e.message);
    return [];
  }
}

async function fetchTVMaze(start: string, days: number): Promise<CalendarItem[]> {
  const allItems: CalendarItem[] = [];
  // TVMaze schedule: 每天一次请求, 串行 (避免 rate limit)
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = ymd(d);
    const url = `${TVMAZE_API_BASE}/schedule/web?date=${dateStr}&country=US`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const data = await r.json();
      for (const ep of (data || [])) {
        const show = ep._embedded?.show || {};
        // TVMaze externals 字段: tmdb / tvdb / imdb
        // tmdb 优先 (跟 SIMKL 字段对齐), 没有就 null
        const tmdbId = show.externals?.tmdb
          ? String(show.externals.tmdb)
          : null;
        allItems.push({
          id: `tvmaze-${ep.id}`,
          source: 'tvmaze',
          tmdbId,
          tvdbId: show.externals?.thetvdb ? String(show.externals.thetvdb) : null,
          title: show.name || '',
          type: 'tv',
          airDate: ep.airdate || dateStr,
          airTime: ep.airtime || null,
          episode: ep.season && ep.number ? {
            season: ep.season,
            number: ep.number,
            title: ep.name || null,
          } : null,
          overview: ep.summary ? ep.summary.replace(/<[^>]+>/g, '').slice(0, 200) : null,
          poster: show.image?.medium || null,
        });
      }
    } catch (e: any) {
      console.warn(`[calendar] TVMaze ${dateStr} failed:`, e.message);
      continue;
    }
  }
  return allItems;
}

function dedupeByTmdbId(items: CalendarItem[]): CalendarItem[] {
  const seen = new Map<string, CalendarItem>();
  for (const it of items) {
    if (!it.tmdbId) {
      // 没 tmdbId 用 source+title+date fallback
      const k = `${it.source}|${it.title}|${it.airDate}`;
      if (!seen.has(k)) seen.set(k, it);
      continue;
    }
    if (!seen.has(it.tmdbId)) seen.set(it.tmdbId, it);
  }
  return Array.from(seen.values());
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start') || ymd(new Date());
  const days = Math.min(60, Math.max(1, parseInt(searchParams.get('days') || '30')));
  const type = (searchParams.get('type') || 'tv').toLowerCase();
  const useSimkl = searchParams.get('simkl') !== '0';
  const useTVMaze = searchParams.get('tvmaze') !== '0';

  if (type !== 'tv' && type !== 'movie' && type !== 'all') {
    return NextResponse.json(
      { error: { code: 'invalid_type', message: 'type 必须是 tv/movie/all', hint: `实际: ${type}` } },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // 算 endDate
  const startDate = new Date(start);
  const endDate = new Date(start);
  endDate.setUTCDate(endDate.getUTCDate() + days - 1);
  const end = ymd(endDate);

  const cacheKey = `calendar:${start}:${days}:${type}:${useSimkl?'1':'0'}:${useTVMaze?'1':'0'}`;

  // 1. 查 cache
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const cacheRows = await sql`
      SELECT data, expires_at, cached_at FROM xx_calendar_cache
      WHERE cache_key = ${cacheKey} AND expires_at > NOW()
      LIMIT 1
    ` as any[];
    if (cacheRows && cacheRows[0]) {
      return NextResponse.json({
        ...cacheRows[0].data,
        cached: true,
        cachedAt: cacheRows[0].cached_at,
        expiresAt: cacheRows[0].expires_at,
        durationMs: Date.now() - t0,
      }, { headers: CORS_HEADERS });
    }
  } catch (e: any) {
    console.warn('[calendar] cache read failed:', e.message);
  }

  // 2. miss -> 并行调 SIMKL + TVMaze
  const [simklItems, tvmazeItems] = await Promise.all([
    useSimkl ? fetchSimkl(start, days) : Promise.resolve([]),
    useTVMaze ? fetchTVMaze(start, days) : Promise.resolve([]),
  ]);

  // 3. 去重 + 按日期排
  let allItems = dedupeByTmdbId([...simklItems, ...tvmazeItems]);
  // type 过滤
  if (type !== 'all') {
    allItems = allItems.filter(it => it.type === type);
  }
  allItems.sort((a, b) => {
    if (a.airDate !== b.airDate) return a.airDate.localeCompare(b.airDate);
    return (a.airTime || '').localeCompare(b.airTime || '');
  });

  // 4. 关联 xx_resources
  const tmdbIds = allItems.map(it => it.tmdbId).filter((id): id is string => !!id);
  let resourceMap = new Map<string, { count: number; sources: string[] }>();
  if (tmdbIds.length > 0) {
    try {
      const rRows = await sql`
        SELECT tmdb_id, COUNT(*) as cnt, array_agg(DISTINCT source) as sources
        FROM xx_resources
        WHERE status = 'active'
          AND tmdb_id = ANY(${tmdbIds})
        GROUP BY tmdb_id
      ` as any[];
      for (const r of (rRows || [])) {
        resourceMap.set(String(r.tmdb_id), { count: parseInt(r.cnt), sources: r.sources || [] });
      }
    } catch (e: any) {
      console.warn('[calendar] xx_resources query failed:', e.message);
    }
  }

  for (const it of allItems) {
    if (it.tmdbId) {
      const local = resourceMap.get(it.tmdbId);
      it.localResourceCount = local?.count || 0;
      it.localSources = local?.sources || [];
    }
  }

  // 5. 按日期分桶
  const byDate: Record<string, CalendarItem[]> = {};
  for (const it of allItems) {
    if (!byDate[it.airDate]) byDate[it.airDate] = [];
    byDate[it.airDate].push(it);
  }

  const response = {
    startDate: start,
    endDate: end,
    days,
    type,
    totalItems: allItems.length,
    simklCount: simklItems.length,
    tvmazeCount: tvmazeItems.length,
    items: allItems,
    byDate,
    cached: false,
    cachedAt: null,
    expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    durationMs: Date.now() - t0,
  };

  // 6. 写 cache
  try {
    await sql`
      INSERT INTO xx_calendar_cache (cache_key, start_date, end_date, source, data, expires_at)
      VALUES (${cacheKey}, ${start}, ${end}, ${'simkl+tvmaze'}, ${JSON.stringify(response)}::jsonb, NOW() + INTERVAL '24 hours')
      ON CONFLICT (cache_key) DO UPDATE SET
        data = EXCLUDED.data,
        expires_at = EXCLUDED.expires_at,
        cached_at = NOW()
    `;
  } catch (e: any) {
    console.warn('[calendar] cache write failed:', e.message);
  }

  return NextResponse.json(response, { headers: CORS_HEADERS });
}
