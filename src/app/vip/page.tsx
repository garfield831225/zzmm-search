'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface VipItem {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  voteAverage: number | null;
  voteCount: number;
  releaseDate: string | null;
  popularity: number;
  genreIds: number[];
  seasonCount: number | null;
  episodeCount: number | null;
  status: string | null;
  hasLink: boolean;
  link: {
    id: number;
    playUrl: string;
    source: string;
    season: number | null;
    episode: number | null;
    lastOkAt: string | null;
  } | null;
}

interface ApiResp {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: VipItem[];
  error?: string;
  globalStats?: { totalResources: number; playableResources: number };
}

type MediaTab = '' | 'movie' | 'tv';
type SortKey = 'smart' | 'popular' | 'rating' | 'newest';

const MEDIA_TABS: { key: MediaTab; label: string; icon: string }[] = [
  { key: '', label: '全部', icon: '🎬' },
  { key: 'movie', label: '电影', icon: '🎥' },
  { key: 'tv', label: '剧集', icon: '📺' },
];

const SORT_TABS: { key: SortKey; label: string; tip: string }[] = [
  { key: 'smart', label: '智能', tip: '有播放链接的优先' },
  { key: 'popular', label: '热度', tip: 'TMDB popularity' },
  { key: 'rating', label: '高评分', tip: 'TMDB 评分' },
  { key: 'newest', label: '最新', tip: '上映日期' },
];

// 2026-07-24: 改成克制的 OLED + 玻璃态 (参考 xingfan.cc 但不花哨)
// 主色: 深空黑 + 紫粉渐变, 玻璃态卡片, 圆角 16px, 极简边框
export default function VipPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [mediaType, setMediaType] = useState<MediaTab>('');
  const [sort, setSort] = useState<SortKey>('smart');
  const [query, setQuery] = useState('');  // 2026-07-26: 搜索关键词
  const [items, setItems] = useState<VipItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [globalStats, setGlobalStats] = useState<{ totalResources: number; playableResources: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-07-25: 用 ref 同步锁防死循环 + 并发 fetch
  const loadingRef = useRef(false);
  const latestReq = useRef(0);

  // 鉴权 - localStorage 检查
  useEffect(() => {
    const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token');
    if (!t) {
      router.replace('/login?redirect=/vip');
      return;
    }
    setAuthChecked(true);
  }, [router]);

  const fetchPage = useCallback(async (p: number, append: boolean) => {
    // 同步锁: ref 立即生效, 阻止并发 fetch
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const reqId = ++latestReq.current;
    try {
      const params = new URLSearchParams({
        page: p.toString(),
        pageSize: '48',
        sort,
      });
      if (mediaType) params.set('mediaType', mediaType);
      if (query.trim()) params.set('q', query.trim());

      const resp = await fetch(`/api/vip?${params.toString()}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('zzmm_token') || ''}` },
      });
      const data: ApiResp = await resp.json();
      // 过期请求忽略 (只处理最新一次)
      if (reqId !== latestReq.current) return;
      if (!data.ok) {
        setError(data.error || `HTTP ${resp.status}`);
        if (resp.status === 403) setTimeout(() => router.push('/'), 1200);
        return;
      }
      setError(null);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setPage(p);
      if (data.globalStats) setGlobalStats(data.globalStats);
    } catch (e: any) {
      if (reqId === latestReq.current) setError(e.message || '网络错误');
    } finally {
      if (reqId === latestReq.current) setLoading(false);
      loadingRef.current = false;
    }
  }, [mediaType, sort, query, router]);

  // 2026-07-25: 死循环修复 - 用 sortRef + mediaRef 替代 useCallback 重渲染
  const sortRef = useRef(sort);
  const mediaRef = useRef(mediaType);
  const queryRef = useRef(query);
  sortRef.current = sort;
  mediaRef.current = mediaType;
  queryRef.current = query;
  useEffect(() => {
    if (!authChecked) return;
    setItems([]);
    setPage(1);
    fetchPage(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaType, sort, query, authChecked]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    fetchPage(page + 1, true);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white relative">
      {/* 顶部细网格背景 (微 OLED 风格, 不夸张) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.08) 0%, transparent 50%), radial-gradient(circle at 80% 100%, rgba(168, 85, 247, 0.06) 0%, transparent 50%)',
        }}
      />

      <div className="relative max-w-[1400px] mx-auto px-5 sm:px-8 py-10">
        {/* 顶部 Header - 极简克制 */}
        <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-px w-6 bg-gradient-to-r from-violet-400 to-transparent" />
              <span className="text-[10px] font-medium tracking-[0.2em] text-white/40 uppercase">Private Collection</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-violet-300 via-fuchsia-300 to-pink-300 bg-clip-text text-transparent">
              VIP 影视区
            </h1>
            <p className="text-xs text-white/40 mt-1.5">
              泽泽妈妈专属 · 暂不公开 · 共 {total.toLocaleString()} 部
            </p>
          </div>
          {/* 资源数 glass badge + 返回首页 */}
          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm text-[11px] text-white/60">
              {/* 2026-07-26: 显示全站可播放 (不受当前 filter/search 影响) */}
              {globalStats ? (
                <>
                  <span className="text-emerald-300 font-medium">{globalStats.playableResources.toLocaleString()}</span> 条可播放
                  {' · '}
                  <span className="text-white/80">{globalStats.totalResources.toLocaleString()}</span> 部全站
                </>
              ) : (
                <>{items.filter((i) => i.hasLink).length} 条可播放 · {total.toLocaleString()} 总</>
              )}
            </div>
            {/* 2026-07-25: 返回首页按钮 */}
            <button
              onClick={() => router.push('/')}
              className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] backdrop-blur-sm text-[11px] text-white/60 hover:text-white transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-0.5">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span>返回首页</span>
            </button>
          </div>
        </div>

        {/* 2026-07-26: 搜索框 + 返回首页 (右上角) */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <form
            onSubmit={(e) => { e.preventDefault(); setQuery(((e.target as HTMLFormElement).elements.namedItem('q') as HTMLInputElement)?.value || ''); }}
            className="flex-1 min-w-[240px] relative"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              name="q"
              defaultValue={query}
              key={query}  // 强制 remount 每次搜索清空
              placeholder="搜索 VIP 影视 (片名 / 原始名 / TMDB ID)..."
              className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.06] focus:border-violet-400/30 backdrop-blur-sm text-sm text-white placeholder-white/40 focus:outline-none transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition"
                title="清空"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            )}
          </form>
        </div>

        {/* 筛选区 - 玻璃态 */}
        <div className="mb-6 p-1 rounded-2xl bg-white/[0.02] border border-white/[0.04] backdrop-blur-sm inline-flex flex-wrap gap-1">
          {MEDIA_TABS.map((tab) => {
            const active = mediaType === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setMediaType(tab.key)}
                className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                  active
                    ? 'bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 text-white border border-violet-400/30'
                    : 'text-white/50 hover:text-white/80'
                }`}
              >
                <span className="mr-1.5">{tab.icon}</span>{tab.label}
              </button>
            );
          })}
          <div className="w-px bg-white/10 my-2 mx-1" />
          {SORT_TABS.map((s) => {
            const active = sort === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                title={s.tip}
                className={`px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  active
                    ? 'bg-white/[0.06] text-white border border-white/15'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* 错误 */}
        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] backdrop-blur-sm text-rose-200 text-sm">
            {error}
          </div>
        )}

        {/* 卡片网格 - 玻璃态克制版 */}
        {items.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-32 text-white/30">
            <div className="text-5xl mb-4 opacity-50">🎬</div>
            <p className="text-base font-medium mb-1.5">还没有数据</p>
            <p className="text-xs text-white/30 text-center max-w-md">
              同步脚本跑起来后会陆续有数据。
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {items.map((it) => (
                <VipCard key={`${it.id}-${it.mediaType}`} item={it} />
              ))}
            </div>

            {/* 加载更多 - 玻璃态按钮 */}
            {hasMore && (
              <div className="mt-12 text-center">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="px-8 py-2.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-50 text-white/70 text-sm font-medium border border-white/[0.06] backdrop-blur-sm transition-all"
                >
                  {loading ? '加载中...' : `加载更多 (还有 ${total - items.length} 部)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 2026-07-24: 克制版卡片 (OLED + 玻璃态, 不像 xingfan 那么黑闪)
function VipCard({ item }: { item: VipItem }) {
  const href = `/vip/${item.id}`;
  return (
    <a href={href} className="group block">
      {/* 海报 - 16:9 改为 2:3 经典海报比例 */}
      <div className="relative aspect-[2/3] rounded-2xl overflow-hidden bg-white/[0.02] ring-1 ring-white/[0.05] group-hover:ring-violet-400/30 transition-all duration-300">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-white/10">
            {item.mediaType === 'movie' ? '🎥' : '📺'}
          </div>
        )}

        {/* 顶部细线条 (类型) */}
        <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-black/40 to-transparent" />

        {/* 类型角标 - 玻璃 */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-black/40 backdrop-blur-md text-white/85 border border-white/10">
          {item.mediaType === 'movie' ? '电影' : '剧集'}
        </div>

        {/* 可播角标 - 极简绿色点 + 字 */}
        {item.hasLink && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/80 backdrop-blur-md text-white flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
            可播
          </div>
        )}

        {/* 底部评分 */}
        {item.voteAverage && item.voteAverage > 0 && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-amber-300 bg-black/50 backdrop-blur-md">
            ★ {item.voteAverage.toFixed(1)}
          </div>
        )}

        {/* 集数标记 */}
        {item.mediaType === 'tv' && item.episodeCount && (
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-white/70 bg-black/50 backdrop-blur-md">
            共 {item.episodeCount} 集
          </div>
        )}
      </div>

      {/* 标题 - 极简 */}
      <div className="mt-2.5 px-1">
        <p className="text-sm font-semibold text-white/90 line-clamp-1 group-hover:text-violet-200 transition-colors">
          {item.title}
        </p>
        <p className="text-[11px] text-white/35 mt-0.5 line-clamp-1">
          {item.releaseDate?.slice(0, 4) || '—'}
          {item.originalTitle && item.originalTitle !== item.title && (
            <span className="ml-1 text-white/20">· {item.originalTitle.slice(0, 18)}</span>
          )}
        </p>
      </div>
    </a>
  );
}
