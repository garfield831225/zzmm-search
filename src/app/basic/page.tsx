'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FILM_CATEGORIES } from '@/lib/categories';

const TMDB_IMAGE_BASE = 'https://image.zzmm-search.uk/t/p/w500';

interface BasicItem {
  resourceId: number;
  tmdbId: string;
  tmdbType: 'movie' | 'tv' | null;
  title: string;
  originalTitle: string | null;
  releaseDate: string;
  posterPath: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  overview: string | null;
  source: string;
  resourceCount: number;
  accessLevel: string;
  category: string;
  isShortDrama?: boolean;
}

// 2026-10-16 P12: 5 行筛选 + SORT 3 按钮 + Per Page (跟首页影视专区一致)
// 2026-10-29: 分类统一到 lib/categories.ts (补上「短剧」)
const CATEGORIES = FILM_CATEGORIES;
const SOURCES = ['全部', '115网盘', '百度网盘', '阿里云盘', '夸克网盘', '磁力链接', 'ed2k链接'];
const REGIONS = ['全部', '大陆', '欧美', '日韩', '港澳台'];
const YEARS = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020', '2010-2019', '2000-2009'];
const MATCH_STATUSES = ['全部', '已批配', '未匹配'];

export default function BasicPage() {
  const [category, setCategory] = useState('全部');
  const [source, setSource] = useState('全部');
  const [region, setRegion] = useState('全部');
  const [year, setYear] = useState('全部');
  const [matchStatus, setMatchStatus] = useState('全部');
  const [sort, setSort] = useState<'release_date' | 'added_time' | 'rating'>('release_date');
  const [pageSize, setPageSize] = useState(30);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<BasicItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const pathname = usePathname();
  const hasLoadedRef = useRef(false);
  const { isReady } = useRequireAuth('/basic');

  // 2026-10-29 🔥 修 Hooks 规则违规 (免费专区「页面加载出错」根因)
  //   早期 return 夹在 useEffect 之前 → 第一次 render (isReady=false) 跳过 useEffect (hook 数 = N)
  //   第二次 render (isReady=true) 补上调 useEffect (hook 数 = N+1)
  //   → React 抛 "Rendered more hooks than during the previous render" → 被 global-error 接住
  //   修法: useEffect 必须提到 if (!isReady) 早期 return 之前 (同 profile/page.tsx 2026-08-17 P0 修法)
  useEffect(() => {
    // 鉴权未就绪不拉数据 (避免未登录白拉一次)
    if (!isReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchData = async () => {
      for (let i = 0; i < 3; i++) {
        if (cancelled) return;
        try {
          const params = new URLSearchParams({
            category,
            source,
            region,
            year,
            matchStatus,
            sort,
            page: String(page),
            pageSize: String(pageSize),
            _t: String(Date.now()),
          });
          if (query.trim()) params.set('q', query.trim());
          const r = await fetch(`/api/basic?${params}`, { cache: 'no-store' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          if (cancelled) return;
          setItems(d.items || []);
          setTotal(d.total || 0);
          setLoading(false);
          setError(null);
          hasLoadedRef.current = true;
          return;
        } catch (e: any) {
          if (i === 2) {
            if (!cancelled) {
              setError(e?.message || '加载失败');
              setLoading(false);
            }
          } else {
            await new Promise(r => setTimeout(r, 500 * (i + 1)));
          }
        }
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [category, source, region, year, matchStatus, sort, pageSize, page, query, pathname, isReady]);

  // ⚠️ 鉴权未就绪 → 显示"加载中" —— 必须放在所有 hook 之后!
  if (!isReady) {
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/50 text-sm">加载中...</div>;
  }

  // 任意筛选变化 → 重置 page=1
  const resetPage = () => setPage(1);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gradient-to-b from-[#0a0a0f] to-[#0a0a0f]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/60 hover:text-white text-sm">← 返回首页</Link>
            <h1 className="text-lg font-bold neon-title">👑 泽泽妈 115 文档专区</h1>
          </div>
          <div className="text-xs text-white/40">共 {total.toLocaleString()} 部 · import_channel=zezhe</div>
        </div>

        {/* 5 行筛选 — 跟首页影视专区一致 */}
        <div className="max-w-7xl mx-auto px-4 pb-3">
          <div className="flex flex-col gap-1.5 p-2 rounded-2xl bg-white/[0.02] border border-white/[0.04] backdrop-blur-sm">
            {/* 分类 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              {CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => { setCategory(cat); resetPage(); }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition shrink-0 ${category === cat
                    ? 'bg-gradient-to-r from-violet-500/25 to-fuchsia-500/25 text-white border border-violet-400/40 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                    : 'bg-white/[0.03] text-white/55 hover:text-white/85 hover:bg-white/[0.06] border border-transparent'}`}>{cat}</button>
              ))}
            </div>
            {/* 来源 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              {SOURCES.map((src) => (
                <button key={src} onClick={() => { setSource(src); resetPage(); }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${source === src
                    ? 'bg-gradient-to-r from-pink-500/25 to-rose-500/25 text-white border border-pink-400/40'
                    : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{src}</button>
              ))}
            </div>
            {/* 地区 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              <span className="text-[10px] text-white/30 self-center mr-0.5 shrink-0 tracking-wider">地区</span>
              {REGIONS.map((r) => (
                <button key={r} onClick={() => { setRegion(r); resetPage(); }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${region === r
                    ? 'bg-gradient-to-r from-orange-500/25 to-amber-500/25 text-white border border-orange-400/40'
                    : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{r}</button>
              ))}
            </div>
            {/* 年份 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              <span className="text-[10px] text-white/30 self-center mr-0.5 shrink-0 tracking-wider">年份</span>
              {YEARS.map((y) => (
                <button key={y} onClick={() => { setYear(y); resetPage(); }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${year === y
                    ? 'bg-gradient-to-r from-cyan-500/25 to-teal-500/25 text-white border border-cyan-400/40'
                    : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{y}</button>
              ))}
            </div>
            {/* 批配状态 */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              <span className="text-[10px] text-white/30 self-center mr-0.5 shrink-0 tracking-wider">批配</span>
              {MATCH_STATUSES.map((ms) => (
                <button key={ms} onClick={() => { setMatchStatus(ms); resetPage(); }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${matchStatus === ms
                    ? 'bg-gradient-to-r from-emerald-500/25 to-teal-500/25 text-white border border-emerald-400/40'
                    : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{ms}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Sort + Per Page */}
        <div className="max-w-7xl mx-auto px-4 pb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 tracking-wider uppercase">Sort</span>
            <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <button onClick={() => { setSort('release_date'); resetPage(); }}
                className={`px-3 py-1 rounded-lg text-xs transition ${sort === 'release_date'
                  ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white shadow-[0_0_8px_rgba(168,85,247,0.2)]'
                  : 'text-white/50 hover:text-white/85'}`}>🎬 上映</button>
              <button onClick={() => { setSort('added_time'); resetPage(); }}
                className={`px-3 py-1 rounded-lg text-xs transition ${sort === 'added_time'
                  ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white shadow-[0_0_8px_rgba(168,85,247,0.2)]'
                  : 'text-white/50 hover:text-white/85'}`}>📅 上架</button>
              <button onClick={() => { setSort('rating'); resetPage(); }}
                className={`px-3 py-1 rounded-lg text-xs transition ${sort === 'rating'
                  ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white shadow-[0_0_8px_rgba(168,85,247,0.2)]'
                  : 'text-white/50 hover:text-white/85'}`}>⭐ 最惠</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 hidden sm:inline tracking-wider uppercase">Per Page</span>
            <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              {[30, 90, 150].map((s) => (
                <button key={s} onClick={() => { setPageSize(s); resetPage(); }}
                  className={`px-3 py-1 rounded-lg text-xs transition ${pageSize === s
                    ? 'bg-gradient-to-r from-pink-500/30 to-rose-500/30 text-white shadow-[0_0_8px_rgba(236,72,153,0.2)]'
                    : 'text-white/50 hover:text-white/85'}`}>{s}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        {loading && items.length === 0 ? (
          <div className="text-center text-white/40 py-16">加载中...</div>
        ) : error && items.length === 0 ? (
          <div className="text-center text-red-400 py-16">
            <div>❌ 加载失败: {error}</div>
            <button onClick={() => { setCategory(category); setPage(page); }} className="mt-3 px-4 py-1.5 bg-pink-600 rounded text-sm">重试</button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center text-white/40 py-16">暂无数据 · 当前筛选下没有结果</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
            {items.map(item => (
              <BasicCard key={`${item.tmdbType}-${item.tmdbId}`} item={item} />
            ))}
          </div>
        )}

        {/* 分页 */}
        {total > pageSize && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-white/5 rounded text-sm disabled:opacity-30 hover:bg-white/10 transition"
            >上一页</button>
            <span className="px-4 py-2 text-sm text-white/60">
              第 {page} 页 · 共 {Math.ceil(total / pageSize)} 页
            </span>
            <button
              onClick={() => setPage((p) => Math.min(Math.ceil(total / pageSize), p + 1))}
              disabled={page >= Math.ceil(total / pageSize)}
              className="px-4 py-2 bg-white/5 rounded text-sm disabled:opacity-30 hover:bg-white/10 transition"
            >下一页</button>
          </div>
        )}

        {loading && items.length > 0 && (
          <div className="fixed top-0 left-0 right-0 h-0.5 bg-pink-500/50 z-50">
            <div className="h-full bg-pink-500 animate-pulse" style={{ width: '60%' }}></div>
          </div>
        )}

        {error && items.length > 0 && (
          <div className="fixed top-14 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-red-500/90 text-white text-xs rounded z-50">
            刷新失败: {error} (显示上次数据)
          </div>
        )}
      </div>
    </div>
  );
}

function BasicCard({ item }: { item: BasicItem }) {
  const router = useRouter();
  const onClick = () => {
    if (item.tmdbType === 'movie' || item.tmdbType === 'tv') {
      router.push(`/tmdb/${item.tmdbType}/${item.tmdbId}`);
    } else {
      router.push(`/library?id=${item.resourceId}`);
    }
  };

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer relative overflow-hidden rounded-md bg-white/5 hover:bg-white/10 transition"
    >
      <div className="aspect-[2/3] bg-gradient-to-br from-pink-900/30 to-violet-900/30 relative">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20 text-2xl">🎬</div>
        )}

        <div className="absolute top-1 left-1 flex flex-col gap-0.5">
          {item.tmdbType === 'tv' ? (
            <span className="px-1 py-0.5 bg-cyan-600/90 text-[9px] rounded">剧集</span>
          ) : item.tmdbType === 'movie' ? (
            <span className="px-1 py-0.5 bg-violet-600/90 text-[9px] rounded">电影</span>
          ) : (
            <span className="px-1 py-0.5 bg-white/20 text-[9px] rounded">未分类</span>
          )}
          {item.resourceCount > 1 && (
            <span className="px-1 py-0.5 bg-pink-500/90 text-white text-[9px] rounded font-semibold">📦 {item.resourceCount} 网盘</span>
          )}
          {item.accessLevel === 'basic' && (
            <span className="px-1 py-0.5 bg-amber-500/90 text-black text-[9px] rounded">👑 泽泽妈</span>
          )}
          {item.isShortDrama && (
            <span className="px-1 py-0.5 bg-pink-500/85 text-white text-[9px] rounded font-medium">🎬 短剧</span>
          )}
        </div>

        {item.voteAverage && item.voteAverage > 0 && (
          <div className="absolute top-1 right-1 px-1 py-0.5 bg-black/70 text-amber-400 text-[9px] rounded">
            ⭐ {item.voteAverage.toFixed(1)}
          </div>
        )}
      </div>

      <div className="p-1.5">
        <div className="text-[11px] font-semibold truncate" title={item.title}>{item.title}</div>
        <div className="text-[9px] text-white/40 mt-0.5 flex items-center gap-1">
          <span>📅 {item.releaseDate}</span>
          {item.source && (
            <span className="px-1 bg-pink-500/20 text-pink-300 rounded text-[8px]">{cleanSource(item.source)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function cleanSource(s: string) {
  return s?.replace(/ \[deleted\]$/, '') || '';
}