import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getUser(req: NextRequest) {
  // 三种方式拿 token: Authorization header > cookie > query (?token=)
  const auth = req.headers.get('authorization');
  let token = '';
  if (auth?.startsWith('Bearer ')) {
    token = auth.replace('Bearer ', '');
  } else {
    // cookie: zzmm_token / token
    token = req.cookies.get('zzmm_token')?.value
         || req.cookies.get('token')?.value
         || '';
    if (!token) {
      // 兜底: query 参数
      token = new URL(req.url).searchParams.get('token') || '';
    }
  }
  if (!token) return null;
  try {
    const payload = jwt.verify(token, (process.env.JWT_SECRET || 'cLWhs2015')) as any;
    const userId = String(payload.id);
    const sql = neon(process.env.DATABASE_URL || '');
    const r = await sql`SELECT id, user_group FROM xx_users WHERE id = ${userId} LIMIT 1`;
    return r[0] ? { id: r[0].id, group: String(r[0].user_group || 'user').toLowerCase() } : null;
  } catch { return null; }
}

const SOURCES: Record<string, { name: string; build: (q: string, page: number, key: string) => string | { url: string; headers?: any } }> = {
  pixabay: {
    name: 'PIXABAY',
    build: (q, page, key) => {
      const params = new URLSearchParams({
        key, q: q || 'popular', page: String(page), per_page: '24', video_type: 'film',
      });
      return `https://pixabay.com/api/videos/?${params}`;
    },
  },
  pexels: {
    name: 'PEXELS',
    build: (q, page, key) => {
      const params = new URLSearchParams({ page: String(page), per_page: '24' });
      if (q) params.set('query', q);
      return { url: `https://api.pexels.com/videos/search?${params}`, headers: { Authorization: key } };
    },
  },
  nasa: {
    name: 'NASA',
    build: (q, page, key) => {
      return `https://api.nasa.gov/planetary/apod?api_key=${key}&count=20&thumbs=true`;
    },
  },
  bilibili: {
    name: 'B站',
    build: (q, page) => {
      return `https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all`;
    },
  },
  tmdb: {
    name: 'TMDB',
    build: (q, page, key) => {
      if (q) {
        return `https://api.themoviedb.org/3/search/movie?api_key=${key}&language=zh-CN&query=${encodeURIComponent(q)}&page=${page}`;
      }
      return `https://api.themoviedb.org/3/movie/popular?api_key=${key}&language=zh-CN&page=${page}`;
    },
  },
  archive: {
    name: 'ARCHIVE',
    build: (q, page) => {
      const qstr = q
        ? `(${encodeURIComponent(q)}) AND mediatype:movies`
        : 'mediatype:movies AND subject:"Feature Films"';
      const params = new URLSearchParams({
        q: qstr,
        fl: 'identifier,title,description,year,creator',
        rows: '24',
        page: String(page),
        output: 'json',
      });
      return `https://archive.org/advancedsearch.php?${params}`;
    },
  },
};

function formatDuration(sec: number) {
  if (!sec) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function formatCount(n: number) {
  if (!n) return '';
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}

// 把第三方源响应统一成 [{thumb, playUrl, title, sub1, sub2, badge, duration, desc, external}]
function normalize(source: string, data: any): any[] {
  if (source === 'pixabay' && data?.hits) {
    return data.hits.map((v: any) => {
      const f = v.videos?.fullHD || v.videos?.large || v.videos?.medium || v.videos?.small;
      return {
        thumb: v.userImageURL || v.videos?.tiny?.thumbnail || `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg`,
        playUrl: f?.url,
        title: v.tags || 'Pixabay 视频',
        sub1: `👤 ${v.user}`,
        sub2: `▶ ${formatCount(v.views)} 次观看`,
        badge: 'PIXABAY',
        duration: formatDuration(f?.duration || 0),
        desc: v.tags,
        external: v.pageURL,
      };
    });
  }
  if (source === 'pexels' && data?.videos) {
    return data.videos.map((v: any) => {
      const f = v.video_files.find((f: any) => f.quality === 'hd') || v.video_files[0];
      return {
        thumb: v.image,
        playUrl: f?.link,
        title: v.user?.name ? `${v.user.name} 作品` : 'Pexels 视频',
        sub1: `👤 ${v.user?.name || ''}`,
        sub2: `⏱ ${v.duration}s · ${v.width}×${v.height}`,
        badge: 'PEXELS',
        duration: formatDuration(v.duration),
        desc: '来自 Pexels 免费素材库',
        external: v.url,
      };
    });
  }
  if (source === 'nasa' && Array.isArray(data)) {
    return data.map((d: any) => {
      const isVideo = d.media_type === 'video';
      return {
        thumb: isVideo ? (d.thumbnail_url || '') : d.url,
        playUrl: isVideo ? d.url : '',
        title: d.title,
        sub1: `📅 ${d.date}`,
        sub2: `© ${d.copyright || 'NASA'}`,
        badge: isVideo ? 'NASA 视频' : 'NASA 图片',
        desc: d.explanation,
        external: isVideo ? d.url : '',
      };
    });
  }
  if (source === 'bilibili' && data?.data?.list) {
    return data.data.list.slice(0, 24).map((v: any) => ({
      thumb: v.pic?.replace(/^\/\//, 'https://') || '',
      playUrl: v.bvid ? `https://player.bilibili.com/player.html?bvid=${v.bvid}&autoplay=1` : '',
      external: v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : '',
      title: v.title,
      sub1: `👤 ${v.author || v.owner?.name || ''}`,
      sub2: `▶ ${formatCount(v.play)} · 💬 ${formatCount(v.danmaku)}`,
      badge: 'B站',
      duration: formatDuration(v.duration),
      desc: v.desc || 'B 站热门视频',
    }));
  }
  if (source === 'tmdb' && data?.results) {
    return data.results.filter((m: any) => m.poster_path).map((m: any) => ({
      thumb: `https://image.tmdb.org/t/p/w500${m.poster_path}`,
      playUrl: '',
      external: `https://www.themoviedb.org/movie/${m.id}`,
      title: m.title || m.original_title,
      sub1: `⭐ ${m.vote_average?.toFixed(1) || '—'}`,
      sub2: m.release_date?.slice(0, 4) || '',
      badge: 'TMDB',
      desc: m.overview,
    }));
  }
  if (source === 'archive' && data?.response?.docs) {
    return data.response.docs.map((d: any) => {
      const id = d.identifier;
      return {
        thumb: `https://archive.org/services/img/${id}`,
        playUrl: `https://archive.org/details/${id}`,
        external: `https://archive.org/details/${id}`,
        title: d.title || id,
        sub1: `📅 ${d.year || '—'}`,
        sub2: `© ${d.creator || '公有领域'}`,
        badge: 'ARCHIVE',
        desc: Array.isArray(d.description) ? d.description[0] : (d.description || 'Internet Archive 公有领域影片'),
      };
    });
  }
  return [];
}

export async function GET(request: NextRequest) {
  // VIP 守卫（最严防护）
  const lockEnabled = process.env.LOCK_PLAYBACK_TO_VIP !== 'false';  // 默认 true
  if (lockEnabled) {
    const user = await getUser(request);
    if (!user) {
      return NextResponse.json({ error: '请先登录', code: 'unauthenticated' }, { status: 401 });
    }
    if (!['vip', 'admin'].includes(user.group)) {
      return NextResponse.json({ error: '需 VIP 会员', code: 'vip_required', userGroup: user.group }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source') || 'pixabay';
  const q = (searchParams.get('q') || '').trim();
  const page = parseInt(searchParams.get('page') || '1');

  if (!SOURCES[source]) {
    return NextResponse.json({ error: 'unknown source', validSources: Object.keys(SOURCES) }, { status: 400 });
  }

  // 取 key（优先 env，fallback Keel demo key）
  const getKey = (s: string) => {
    if (s === 'pixabay') return process.env.PIXABAY_KEY || '48390253-7c5b0d4f4f7d0c0e6e8c8c6c2';
    if (s === 'pexels')  return process.env.PEXELS_KEY  || 'C3CYnLqJN2T7vMg0wMqSdKZWBkAd4HLGfXb0hFOJpYp4Y6q3yWt1OHHc';
    if (s === 'tmdb')    return process.env.TMDB_API_KEY || '7985342d5961e9ee3d5ef6d969c1b8dd';
    if (s === 'nasa')    return process.env.NASA_KEY   || 'DEMO_KEY';
    return '';
  };
  const key = getKey(source);

  const req = SOURCES[source].build(q, page, key);
  const url = typeof req === 'string' ? req : req.url;
  const headers: any = typeof req === 'string' ? {} : (req.headers || {});

  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      return NextResponse.json({ error: `上游 ${r.status}`, source, items: [] }, { status: 502 });
    }
    const data = await r.json();
    const items = normalize(source, data);
    return NextResponse.json({
      source,
      page,
      total: items.length,
      items,
      hasMore: items.length === 24,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'fetch failed', source, items: [] }, { status: 502 });
  }
}
