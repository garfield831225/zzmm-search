'use client';
// 2026-08-04: P9 恢复 /vip 基础功能 (原版搜索/排序/鉴权/详情/无限滚动)
//   - 用户选 B: 恢复 425 行功能完整版
//   - 适配新 /api/vip 字段: id→resourceId, mediaType→tmdbType, hasLink→resourceCount>0
//   - 加 ErrorBoundary (上次 client-side exception 教训)
//   - 保留 basic 用户看到升级提示页

import { useState, useEffect, useCallback, useRef, Component, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

// 2026-08-04: ErrorBoundary - 防止 client-side 报错让整页空白 (血的教训 #21)
class VipErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; err?: string }> {
  constructor(p: any) { super(p); this.state = { hasError: false }; }
  static getDerivedStateFromError(err: Error) { return { hasError: true, err: err.message }; }
  componentDidCatch(err: Error, info: any) {
    console.error('[vip-page-error]', err, info);
    try {
      fetch('/api/vip/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message, stack: err.stack, page: '/vip' }),
      }).catch(() => {});
    } catch {}
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-6 text-center">
            <div className="text-3xl mb-3">⚠️</div>
            <div className="text-lg font-bold mb-2 text-red-300">页面加载出错</div>
            <div className="text-sm text-red-200/80 mb-4 font-mono break-all">{this.state.err}</div>
            <button onClick={() => location.reload()} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded text-sm">刷新</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// 2026-08-04: VipItem 适配新 /api/vip 字段
interface VipItem {
  resourceId: number;
  tmdbId: string;
  tmdbType: 'movie' | 'tv' | null;
  title: string;
  originalTitle: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  releaseDate: string;
  source: string;
  resourceCount: number;
  accessLevel: string;
  category: string;
}

interface ApiResp {
  ok?: boolean;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: VipItem[];
  error?: string;
}

type MediaTab = '' | 'movie' | 'tv';
type SortKey = 'newest' | 'rating' | 'popular' | 'smart';

const MEDIA_TABS: { key: MediaTab; label: string; icon: string }[] = [
  { key: '', label: '全部', icon: '🎬' },
  { key: 'movie', label: '电影', icon: '🎥' },
  { key: 'tv', label: '剧集', icon: '📺' },
];

// 2026-08-04: 排序选项 - 适配新 API (新 API 只支持 sort=newest, 智能/热度/评分是客户端 fake)
const SORT_TABS: { key: SortKey; label: string; tip: string }[] = [
  { key: 'newest', label: '最新', tip: '上映日期 (新→旧)' },
  { key: 'rating', label: '高评分', tip: 'TMDB 评分 (客户端排序)' },
  { key: 'smart', label: '智能', tip: '多网盘优先' },
  { key: 'popular', label: '热度', tip: '按 source 排序' },
];

export default function VipPage() {
  return (
    <VipErrorBoundary>
      <VipPageInner />
    </VipErrorBoundary>
  );
}

function VipPageInner() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [userGroup, setUserGroup] = useState<string>('');
  const [mediaType, setMediaType] = useState<MediaTab>('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<VipItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const latestReq = useRef(0);

  // 鉴权 - localStorage 检查
  useEffect(() => {
    const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token');
    if (!t) {
      router.replace('/login?redirect=/vip');
      return;
    }
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      setUserGroup(String(u.user_group || u.group || '').toLowerCase());
    } catch {}
    setAuthChecked(true);
  }, [router]);

  const fetchPage = useCallback(async (p: number, append: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const reqId = ++latestReq.current;
    try {
      // 2026-08-04: 新 API 参数 type= 而不是 mediaType
      // sort: 新 API 内部按 release_date desc 排 (只支持默认), 客户端不传 sort
      const params = new URLSearchParams({
        page: p.toString(),
        pageSize: '30',
      });
      if (mediaType) params.set('type', mediaType);
      if (query.trim()) {
        // 新 API 没有 q 参数, 不传
      }

      const resp = await fetch(`/api/vip?${params.toString()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' },
      });
      const data: ApiResp = await resp.json();
      if (reqId !== latestReq.current) return;
      if (data.error || !data.items) {
        setError(data.error || `HTTP ${resp.status}`);
        if (resp.status === 403) setTimeout(() => router.push('/'), 1200);
        return;
      }
      setError(null);
      setTotal(data.total || 0);
      setHasMore(data.hasMore || false);
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setPage(p);
    } catch (e: any) {
      if (reqId === latestReq.current) setError(e?.message || '网络错误');
    } finally {
      if (reqId === latestReq.current) setLoading(false);
      loadingRef.current = false;
    }
  }, [mediaType, query, router]);

  // 触发 fetch (debounce query 1 秒)
  useEffect(() => {
    if (!authChecked) return;
    setItems([]);
    setPage(1);
    fetchPage(1, false);
  }, [mediaType, authChecked]);

  // query 搜索 debounce
  useEffect(() => {
    if (!authChecked) return;
    const t = setTimeout(() => {
      setItems([]);
      setPage(1);
      fetchPage(1, false);
    }, 600);
    return () => clearTimeout(t);
  }, [query, authChecked]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    fetchPage(page + 1, true);
  };

  // basic 用户看到升级提示页
  if (authChecked && userGroup === 'basic') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white relative flex items-center justify-center p-4">
        <div className="bg-[#12121a] rounded-2xl p-8 md:p-10 max-w-md w-full border border-amber-500/20 text-center">
          <div className="text-5xl mb-4">👑</div>
          <h1 className="text-2xl font-bold mb-2 bg-gradient-to-r from-amber-300 via-pink-300 to-violet-300 bg-clip-text text-transparent">
            VIP 影视区
          </h1>
          <p className="text-sm text-white/60 mb-6 leading-relaxed">
            基础会员可正常浏览主站影视资源<br />
            <span className="text-amber-300">VIP 影视区</span> 需升级会员后解锁
          </p>
          <div className="bg-white/5 rounded-xl p-4 mb-6 text-left text-sm space-y-1.5">
            <div className="flex justify-between text-white/60"><span>月度</span><span className="text-amber-300 font-medium">¥15</span></div>
            <div className="flex justify-between text-white/60"><span>季度</span><span className="text-amber-300 font-medium">¥40</span></div>
            <div className="flex justify-between text-white/60"><span>年度 (热销)</span><span className="text-amber-300 font-medium">¥150</span></div>
            <div className="flex justify-between text-white/60"><span>永久 (至尊)</span><span className="text-amber-300 font-medium">¥388</span></div>
          </div>
          <a
            href="/upgrade"
            className="block w-full py-3 bg-gradient-to-r from-amber-500 to-pink-500 hover:opacity-90 rounded-xl font-semibold transition mb-3"
          >
            🛒 前往闲鱼选购
          </a>
          <button
            onClick={() => router.push('/')}
            className="block w-full py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-white/70 transition"
          >
            ← 返回首页
          </button>
        </div>
      </div>
    );
  }

  // 客户端排序: 新 API 只返按 release_date desc 排的数据, 其他 sort 客户端排
  const sortedItems = (() => {
    if (sort === 'newest') return items;
    if (sort === 'rating') {
      return [...items].sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0));
    }
    if (sort === 'smart') {
      return [...items].sort((a, b) => (b.resourceCount || 0) - (a.resourceCount || 0));
    }
    if (sort === 'popular') {
      // 按 source 优先级: magnet > 115 > aliyun > quark > baidu > 其他
      const rank = (s: string) => ({ magnet: 5, '115': 4, aliyun: 3, quark: 2, baidu: 1 }[s] || 0);
      return [...items].sort((a, b) => rank(b.source) - rank(a.source));
    }
    return items;
  })();

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white relative">
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.08) 0%, transparent 50%), radial-gradient(circle at 80% 100%, rgba(168, 85, 247, 0.06) 0%, transparent 50%)',
        }}
      />

      <div className="relative max-w-[1400px] mx-auto px-5 sm:px-8 py-10">
        {/* 顶部 Header */}
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
          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm text-[11px] text-white/60">
              {sortedItems.filter((i) => i.resourceCount > 0).length} 条多网盘 · {total.toLocaleString()} 总
            </div>
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

        {/* 搜索框 */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <form
            onSubmit={(e) => { e.preventDefault(); /* 实时搜索, 不需要 submit */ }}
            className="flex-1 min-w-[240px] relative"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              name="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索 VIP 影视 (暂未启用, 后端待加)..."
              disabled
              className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.06] focus:border-violet-400/30 backdrop-blur-sm text-sm text-white placeholder-white/40 focus:outline-none transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
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

        {/* 筛选区 */}
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

        {/* 卡片网格 */}
        {sortedItems.length === 0 && !loading ? (
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
              {sortedItems.map((it) => (
                <VipCard key={`${it.resourceId}-${it.tmdbId}`} item={it} />
              ))}
            </div>

            {hasMore && (
              <div className="mt-12 text-center">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="px-8 py-2.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-50 text-white/70 text-sm font-medium border border-white/[0.06] backdrop-blur-sm transition-all"
                >
                  {loading ? '加载中...' : `加载更多 (还有 ${total - sortedItems.length} 部)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function VipCard({ item }: { item: VipItem }) {
  // 2026-08-04: VIP 影视区是看视频的专区, 跳 /vip/[id] 走 playerla 视频播放页
  //   - resourceId 是 xx_resources.id 主键
  //   - /vip/[id] 页面会拿 id 查资源 + 渲染 playerla iframe + 选 source
  const href = `/vip/${item.resourceId}`;

  return (
    <a href={href} className="group block">
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
            {item.tmdbType === 'movie' ? '🎥' : '📺'}
          </div>
        )}

        <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-black/40 to-transparent" />

        {/* 类型角标 */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-black/40 backdrop-blur-md text-white/85 border border-white/10">
          {item.tmdbType === 'movie' ? '电影' : item.tmdbType === 'tv' ? '剧集' : (item.category || '未分类')}
        </div>

        {/* 多网盘角标 */}
        {item.resourceCount > 1 && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/80 backdrop-blur-md text-white flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
            {item.resourceCount} 网盘
          </div>
        )}

        {/* 评分 */}
        {item.voteAverage != null && item.voteAverage > 0 && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-amber-300 bg-black/50 backdrop-blur-md">
            ★ {item.voteAverage.toFixed(1)}
          </div>
        )}

        {/* 来源标签 (左下) */}
        {item.source && (
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-white/70 bg-black/50 backdrop-blur-md">
            {item.source}
          </div>
        )}
      </div>

      <div className="mt-2.5 px-1">
        <p className="text-sm font-semibold text-white/90 line-clamp-1 group-hover:text-violet-200 transition-colors">
          {item.title || '未命名'}
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
