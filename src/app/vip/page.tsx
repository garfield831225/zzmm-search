'use client';

import { useEffect, useState, useCallback } from 'react';
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
}

type MediaTab = '' | 'movie' | 'tv';
type SortKey = 'smart' | 'popular' | 'rating' | 'newest';

const MEDIA_TABS: Array<{ key: MediaTab; label: string; icon: string }> = [
  { key: '', label: '全部', icon: '🎬' },
  { key: 'movie', label: '电影', icon: '🎥' },
  { key: 'tv', label: '剧集', icon: '📺' },
];

const SORT_TABS: Array<{ key: SortKey; label: string; tip: string }> = [
  { key: 'smart', label: '智能', tip: '有播放链接的优先' },
  { key: 'popular', label: '热度', tip: 'TMDB popularity' },
  { key: 'rating', label: '高评分', tip: 'TMDB 评分' },
  { key: 'newest', label: '最新', tip: '上映日期' },
];

export default function VipPage() {
  const router = useRouter();
  const [mediaType, setMediaType] = useState<MediaTab>('');
  const [sort, setSort] = useState<SortKey>('smart');
  const [items, setItems] = useState<VipItem[]>([]);
  const [page, setPage] = useState(1);
  const [authChecked, setAuthChecked] = useState(false);

  // 2026-07-24: client-side 鉴权 - 没登录跳 /login?redirect=/vip
  // 注: middleware 已经不放行 RSC fetch, 这里只防直接访问 HTML 的情况
  useEffect(() => {
    const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token');
    if (!t) {
      router.replace('/login?redirect=/vip');
      return;
    }
    setAuthChecked(true);
  }, [router]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (pageToLoad: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(pageToLoad),
        pageSize: '48',
        sort,
      });
      if (mediaType) params.set('mediaType', mediaType);

      const resp = await fetch(`/api/vip?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await resp.json()) as ApiResp;
      if (!resp.ok || !data.ok) {
        setError(data.error || `HTTP ${resp.status}`);
        if (resp.status === 403) {
          // 没权限, 回首页
          setTimeout(() => router.push('/'), 1200);
        }
        return;
      }
      setTotal(data.total);
      setHasMore(data.hasMore);
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
    } catch (e: any) {
      setError(e.message || '网络错误');
    } finally {
      setLoading(false);
    }
  }, [mediaType, sort, router]);

  useEffect(() => {
    if (!authChecked) return;
    setItems([]);
    setPage(1);
    fetchPage(1, false);
  }, [mediaType, sort, fetchPage, authChecked]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    const next = page + 1;
    setPage(next);
    fetchPage(next, true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 标题区 */}
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
            VIP 影视区
          </h1>
          <p className="text-sm text-white/40 mt-1">
            {total > 0 ? `共 ${total.toLocaleString()} 条资源` : '暂无数据, 等待 TMDB 同步...'}
            {items.filter((i) => i.hasLink).length > 0 && (
              <span className="ml-2 text-indigo-300">
                · {items.filter((i) => i.hasLink).length} 条可播放
              </span>
            )}
          </p>
        </div>

        {/* 媒体类型切换 */}
        <div className="flex flex-wrap gap-2 mb-4">
          {MEDIA_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setMediaType(tab.key)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                mediaType === tab.key
                  ? 'bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-lg'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              <span className="mr-1">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 排序切换 */}
        <div className="flex flex-wrap gap-2 mb-6">
          {SORT_TABS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              title={s.tip}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                sort === s.key
                  ? 'bg-white/15 text-white border border-white/20'
                  : 'bg-white/[0.03] text-white/40 hover:text-white/70 border border-white/[0.05]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* 错误 */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200 text-sm">
            {error}
          </div>
        )}

        {/* 列表 */}
        {items.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-32 text-white/30">
            <div className="text-6xl mb-4">🎬</div>
            <p className="text-lg font-bold">还没有数据</p>
            <p className="text-sm mt-2 text-center max-w-md">
              同步脚本跑起来后会陆续有数据。<br />
              第一次入库预计 3000 条 (今晚)。
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {items.map((it) => (
                <a
                  key={`${it.id}-${it.mediaType}`}
                  href={`/vip/${it.id}`}
                  className="group block"
                >
                  <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 ring-1 ring-white/[0.06] group-hover:ring-indigo-400/40 transition-all">
                    {it.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.posterUrl}
                        alt={it.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-white/20">
                        {it.mediaType === 'movie' ? '🎥' : '📺'}
                      </div>
                    )}

                    {/* 类型角标 */}
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-black/60 backdrop-blur-sm text-white/80">
                      {it.mediaType === 'movie' ? '电影' : '剧集'}
                    </div>

                    {/* 播放链接角标 */}
                    {it.hasLink && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
                        ▶ 可播
                      </div>
                    )}

                    {/* 评分 */}
                    {it.voteAverage && it.voteAverage > 0 && (
                      <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md text-[10px] font-extrabold text-amber-300 bg-black/60 backdrop-blur-sm flex items-center gap-0.5">
                        <span>★</span>
                        {it.voteAverage.toFixed(1)}
                      </div>
                    )}
                  </div>

                  <div className="mt-2">
                    <p className="text-sm font-bold text-white/90 truncate group-hover:text-indigo-300 transition-colors">
                      {it.title}
                    </p>
                    <p className="text-[11px] text-white/35 truncate">
                      {it.releaseDate?.slice(0, 4) || '—'}
                      {it.mediaType === 'tv' && it.episodeCount && ` · 共 ${it.episodeCount} 集`}
                      {it.originalTitle && it.originalTitle !== it.title && (
                        <span className="ml-1 text-white/25">/ {it.originalTitle.slice(0, 20)}</span>
                      )}
                    </p>
                  </div>
                </a>
              ))}
            </div>

            {/* 加载更多 */}
            {hasMore && (
              <div className="mt-8 text-center">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-sm font-bold border border-white/10 disabled:opacity-50"
                >
                  {loading ? '加载中...' : `加载更多 (还有 ${total - items.length} 条)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
