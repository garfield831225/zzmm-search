// 拉 B站热门视频, 缓存5 分钟
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

async function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization');
  let token = '';
  if (auth?.startsWith('Bearer ')) token = auth.replace('Bearer ', '');
  else token = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value || '';
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET) as any; } catch { return null; }
}

// 进程内缓存
let cache: { data: any[]; expiresAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

interface BiliHot {
  rid: number;        // 排行分区 (0=全站, 1=动画, 168=影视)
  title: string;
  pic: string;
  bvid: string;
  author: string;
  play: number;
  danmaku: number;
  duration: string;
}

const RID_MAP: Record<string, number> = {
  all: 0,
  anime: 1,
  movie: 23,        // 电影
  tv: 11,           // 国产剧
  variety: 71,      // 综艺
  doc: 37,          // 纪录片
};

async function fetchBiliHot(rid: number): Promise<BiliHot[]> {
  // B站官方公开 API
  const url = `https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  const j = await r.json();
  const list = j?.data?.list || [];
  return list.slice(0, 24).map((v: any) => ({
    rid,
    title: v.title,
    pic: (v.pic || '').replace(/^\/\//, 'https://'),
    bvid: v.bvid,
    author: v.author || v.owner?.name || '',
    play: v.play || 0,
    danmaku: v.danmaku || 0,
    duration: formatDuration(v.duration || 0),
  }));
}

function formatDuration(sec: number) {
  if (!sec) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function formatCount(n: number) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') || 'all';
  const rid = RID_MAP[category] ?? 0;

  // 检查缓存
  const cacheKey = `${category}`;
  if (cache && cache.data && (cache as any).key === cacheKey && cache.expiresAt > Date.now()) {
    return NextResponse.json({ items: cache.data, cached: true, cache_age: Math.round((Date.now() - (cache as any).createdAt) / 1000) + 's' });
  }

  try {
    const items = await fetchBiliHot(rid);
    // 给每个 item 加 search_url (8 个公开搜索站跳转)
    const enriched = items.map(it => ({
      ...it,
      play_label: formatCount(it.play),
      danmaku_label: formatCount(it.danmaku),
      bilibili_search: `https://search.bilibili.com/all?keyword=${encodeURIComponent(it.title)}`,
      youku_search: `https://so.youku.com/search_video/q_${encodeURIComponent(it.title)}`,
      tencent_search: `https://v.qq.com/x/search/?q=${encodeURIComponent(it.title)}`,
      iqiyi_search: `https://so.iqiyi.com/so/q_${encodeURIComponent(it.title)}`,
      mgtv_search: `https://so.mgtv.com/so?k=${encodeURIComponent(it.title)}`,
      xigua_search: `https://www.ixigua.com/search/${encodeURIComponent(it.title)}/`,
      acfun_search: `https://www.acfun.cn/search?keyword=${encodeURIComponent(it.title)}`,
      douban_search: `https://www.douban.com/search?cat=1002&q=${encodeURIComponent(it.title)}`,
      watch_url: `https://www.bilibili.com/video/${it.bvid}`,
    }));

    cache = { data: enriched, expiresAt: Date.now() + CACHE_TTL, ...{ key: cacheKey, createdAt: Date.now() } } as any;

    return NextResponse.json({ items: enriched, category, cached: false });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, items: [] }, { status: 502 });
  }
}