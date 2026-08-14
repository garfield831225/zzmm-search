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
  country?: string;        // 2026-08-14: TVMaze 来源国家 (US/GB/CN/JP/KR 等)
  // 关联 xx_resources
  localResourceCount?: number;
  localSources?: string[];
}

async function fetchSimkl(start: string, days: number): Promise<CalendarItem[]> {
  // 2026-08-14: SIMKL 公共日历用 CDN 公开 endpoint (no auth)
  //   URL: https://data.simkl.in/calendar/tv.json
  //   返 4498 条 / 35 天, 含 ids.tmdb 可拼 TMDB poster
  //   不要 client_id 也不要 OAuth, 直连直读
  const url = `https://data.simkl.in/calendar/tv.json`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      console.warn(`[calendar] SIMKL CDN ${r.status}`);
      return [];
    }
    const data = await r.json();
    const startDate = new Date(start);
    const endDate = new Date(start);
    endDate.setUTCDate(endDate.getUTCDate() + days - 1);
    const startStr = ymd(startDate);
    const endStr = ymd(endDate);

    const items: CalendarItem[] = [];
    // 用 SIMKL poster 路径拼完整 URL (e.g. https://simkl.in/posters/11/111007766a924bf140_m.webp)
    // 失败也没事, 后面 UI 用 TMDB poster 兜底
    for (const it of (data || [])) {
      if (!it.date) continue;
      const dateStr = it.date.slice(0, 10);  // YYYY-MM-DD
      if (dateStr < startStr || dateStr > endStr) continue;
      const tmdbId = it.ids?.tmdb ? String(it.ids.tmdb) : null;
      const simklPoster = it.poster ? `https://simkl.in/posters/${it.poster}_m.webp` : null;
      items.push({
        id: `simkl-${it.ids?.simkl_id || it.ids?.tmdb || it.title || Math.random()}-${dateStr}-${it.episode?.season || 0}-${it.episode?.episode || 0}`,
        source: 'simkl',
        tmdbId,
        tvdbId: it.ids?.tvdb ? String(it.ids.tvdb) : null,
        title: it.title || '',
        type: 'tv',
        airDate: dateStr,
        airTime: null,
        episode: it.episode ? {
          season: it.episode.season,
          number: it.episode.episode,
          title: null,
        } : null,
        overview: null,
        poster: simklPoster,
      });
    }
    return items;
  } catch (e: any) {
    console.warn('[calendar] SIMKL CDN failed:', e.message);
    return [];
  }
}

async function fetchTVMaze(start: string, days: number): Promise<CalendarItem[]> {
  const allItems: CalendarItem[] = [];
  // 2026-08-14: 多国 (US/GB/CA/AU/DE/FR/JP/KR/CN) 并行
  //   串行按天 + 并行国家, 总请求 30 天 × 9 国 = 270 次, ~14 秒完成
  const COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'KR', 'CN'];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = ymd(d);
    // 9 国并发, 一国返 0 不影响其他
    const results = await Promise.allSettled(
      COUNTRIES.map(c => fetch(`${TVMAZE_API_BASE}/schedule/web?date=${dateStr}&country=${c}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : []))
    );
    for (let ci = 0; ci < COUNTRIES.length; ci++) {
      const r = results[ci];
      const country = COUNTRIES[ci];
      if (r.status !== 'fulfilled') continue;
      const data = r.value || [];
      for (const ep of (data || [])) {
        const show = ep._embedded?.show || {};
        // 2026-08-14: 过滤掉非剧情类 (新闻/脱口秀/游戏节目/真人秀/体育/谈话)
        //   TVMaze type: "Scripted" (剧情) | "Animation" | "Reality" | "Talk Show" | "Game Show" | "News" | "Sports" | "Variety" | "Panel Show"
        //   - 首字母大写, 我之前 lowercase 比较错配
        //   - 加 genres.length > 0 (新闻类 genres 通常为空)
        const showType = show.type || '';
        const isScripted = showType === 'Scripted' || showType === 'Animation';
        const hasGenre = Array.isArray(show.genres) && show.genres.length > 0;
        if (!isScripted || !hasGenre) continue;
        const tmdbId = show.externals?.tmdb ? String(show.externals.tmdb) : null;
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
          poster: show.image?.medium || show.image?.original || null,
          country,  // 2026-08-14: 标记国家
        });
      }
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
  const region = (searchParams.get('region') || 'all').toLowerCase();

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

  const cacheKey = `calendar:${start}:${days}:${type}:${region}:${useSimkl?'1':'0'}:${useTVMaze?'1':'0'}`;

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

  // 2026-08-14: region 提前定义 (用于 cache key + 过滤)
  // (region 已在 line 188 定义)

  // 2026-08-14: SIMKL 没 type/genre 字段, if 链过滤 (避开 swc minifier 改 regex)
  //   - 剔除: 体育/新闻/真人秀/纪录片/脱口秀/烹饪/家装/钓鱼/购物/旅游/生活类
  //   - 关键词要具体, 别加 "garden" (会误伤 garden-of-sinners 之类的)
  function isSimklJunk(title: string): boolean {
    const t = title.toLowerCase();
    if (t.includes('sport')) return true;
    if (t.includes('racing') || t.includes('race') || t.includes('championship')) return true;
    if (t.includes('world cup') || t.includes('masters') || t.includes('olympic')) return true;
    if (t.includes('football') || t.includes('soccer') || t.includes('basketball') || t.includes('baseball')) return true;
    if (t.includes('jays') || t.includes('tennis') || t.includes('golf')) return true;
    if (t.includes('boxing') || t.includes('mma') || t.includes('ufc') || t.includes('wrestling')) return true;
    if (t.includes('poker') || t.includes('cricket') || t.includes('rugby') || t.includes('hockey')) return true;
    if (t.includes('fishing') || t.includes('hunter')) return true;
    if (t.includes('cooking') || t.includes('bake off') || t.includes('baking')) return true;
    if (t.includes('chef') || t.includes('kitchen') || t.includes('recipe')) return true;
    if (t.includes('home cook') || t.includes('home and away')) return true;
    if (t.includes('gardening') || t.includes('house hunters') || t.includes('antiques')) return true;
    if (t.includes('roadshow') || t.includes('travel show') || t.includes('expedition') || t.includes('tourism')) return true;
    if (t.includes('news') || t.includes('newsroom') || t.includes('breaking')) return true;
    if (t.includes('spiegel') || t.includes('zdf.') || t.includes('reportage')) return true;
    if (t.includes('documentary') || t.includes('investigation')) return true;
    if (t.includes('talk show') || t.includes('game show') || t.includes('variety') || t.includes('panel show')) return true;
    if (t.includes('award') || t.includes('red carpet') || t.includes('fashion week')) return true;
    if (t.includes('concert tour') || t.includes('festival') || t.includes('karaoke')) return true;
    if (t.includes('behind the scenes') || t.includes('highlights') || t.includes('backstage')) return true;
    if (t.includes('recap') || t.includes('preview') || t.includes('teaser') || t.includes('trailer')) return true;
    if (t.includes('special') || t.includes('pilot special')) return true;
    if (t.includes('cabin masters') || t.includes('blind box') || t.includes('butter please')) return true;
    if (t.includes('ca pousse') || t.includes('schloss') || t.includes('haus ')) return true;
    if (t.includes('top 10') || t.includes('best of') || t.includes('roundup') || t.includes('rewind')) return true;
    if (t.includes('flashback') || t.includes('throwback') || t.includes('weekly') || t.includes('monthly')) return true;
    if (t.includes('daily show') || t.includes('today show') || t.includes('tonight show') || t.includes('late night')) return true;
    if (t.includes('morning show') || t.includes('daytime') || t.includes('mid season') || t.includes('finale')) return true;
    if (t.includes('marathon') || t.includes('recap') || t.includes('sneak peek') || t.includes('first look')) return true;
    if (t.includes('press conference') || t.includes('town hall') || t.includes('fan meet') || t.includes('premiere')) return true;
    if (t.includes('red carpet') || t.includes('launch party') || t.includes('opening ceremony')) return true;
    if (t.includes('blooper') || t.includes('outtake') || t.includes('deleted scene') || t.includes('director')) return true;
    if (t.includes('commentary') || t.includes('episode 0')) return true;
    return false;
  }
  // 2026-08-14: 每国每日期限条数 (避免 CN 19 条刷屏)
  //   - SIMKL (欧美): 5/天
  //   - 欧美 TVMaze (US/GB/CA/AU/DE/FR): 3/天/国
  //   - 亚洲 TVMaze (CN/JP/KR/TW/HK): 3/天/国
  const SIMKL_DAILY_LIMIT = 5;
  const TVMAZE_DAILY_PER_COUNTRY = 3;
  const filteredSimklItems: CalendarItem[] = [];
  const simklByDate: Record<string, CalendarItem[]> = {};
  for (const it of simklItems) {
    if (isSimklJunk(it.title)) continue;
    if (!simklByDate[it.airDate]) simklByDate[it.airDate] = [];
    simklByDate[it.airDate].push(it);
  }
  for (const date in simklByDate) {
    filteredSimklItems.push(...simklByDate[date].slice(0, SIMKL_DAILY_LIMIT));
  }

  // TVMaze 多国每国每日期限
  const tvmazeByDateCountry: Record<string, Record<string, CalendarItem[]>> = {};
  const filteredTvmazeItems: CalendarItem[] = [];
  for (const it of tvmazeItems) {
    const date = it.airDate;
    const c = it.country || 'US';
    if (!tvmazeByDateCountry[date]) tvmazeByDateCountry[date] = {};
    if (!tvmazeByDateCountry[date][c]) tvmazeByDateCountry[date][c] = [];
    tvmazeByDateCountry[date][c].push(it);
  }
  for (const date in tvmazeByDateCountry) {
    for (const c in tvmazeByDateCountry[date]) {
      filteredTvmazeItems.push(...tvmazeByDateCountry[date][c].slice(0, TVMAZE_DAILY_PER_COUNTRY));
    }
  }

  // 3. 去重 + 按日期排
  let allItems = dedupeByTmdbId([...filteredSimklItems, ...filteredTvmazeItems]);
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

  // 5. 按 region 过滤 (UI 切换 全部/亚洲/欧美)
  //   SIMKL 算欧美
  //   TVMaze: CN/JP/KR/TW/HK 算亚洲, 其他算欧美
  if (region === 'asia') {
    allItems = allItems.filter(it => {
      if (it.source === 'simkl') return false;
      return ['CN', 'JP', 'KR', 'TW', 'HK'].includes(it.country || '');
    });
  } else if (region === 'eu') {
    allItems = allItems.filter(it => {
      if (it.source === 'simkl') return true;
      return !['CN', 'JP', 'KR', 'TW', 'HK'].includes(it.country || '');
    });
  }

  // 6. 按日期分桶
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
    region,
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
