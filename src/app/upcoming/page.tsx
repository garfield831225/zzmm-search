'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useRequireAuth } from '@/lib/use-require-auth';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

interface UpcomingItem {
  id: number;
  tmdbId: number;
  tmdbType: 'movie' | 'tv';
  title: string;
  originalTitle: string | null;
  releaseDate: string;
  posterPath: string | null;
  backdropPath: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  overview: string | null;
  hasMatch: boolean;
  matchedResourceId: number | null;
  matchedName: string | null;
  matchedSource: string | null;
  matchedAccessLevel: string | null;
}

type Tab = 'all' | 'movie' | 'tv';

export default function UpcomingPage() {
  // 2026-08-15: client-side 鉴权 (替代不跑的 middleware)
  const { authChecked } = useRequireAuth('/upcoming');
  const [tab, setTab] = useState<Tab>('all');
  const [items, setItems] = useState<UpcomingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const hasLoadedRef = useRef(false);

  if (!authChecked) {
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/50 text-sm">加载中...</div>;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchData = async () => {
      // 2026-08-03 修 #2: retry 3 次, catch 不清空 items (保留上次数据), 加 _t 强制 bust
      for (let i = 0; i < 3; i++) {
        if (cancelled) return;
        try {
          const r = await fetch(`/api/upcoming?type=${tab}&pageSize=60&_t=${Date.now()}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' },
          });
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
          // 最后一次失败才显示错误, 但不清空 items (保留上次)
          if (i === 2) {
            if (!cancelled) {
              setError(e?.message || '加载失败');
              setLoading(false);
            }
          } else {
            // 等 500ms * (i+1) 后重试
            await new Promise(r => setTimeout(r, 500 * (i + 1)));
          }
        }
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [tab, pathname]);  // 重新进入时 (即使 tab 不变, 组件重 mount) 也重跑

  const movies = items.filter(i => i.tmdbType === 'movie');
  const tvs = items.filter(i => i.tmdbType === 'tv');

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gradient-to-b from-[#0a0a0f] to-[#0a0a0f]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/60 hover:text-white text-sm">← 返回首页</Link>
            <h1 className="text-lg font-bold">🆕 最新上映 (近 30 天)</h1>
          </div>
          <div className="text-xs text-white/40">共 {total} 部 · 每天 03:30 自动更新</div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 pb-3 flex gap-2">
          {([
            { k: 'all', n: `全部 (${total})` },
            { k: 'movie', n: `电影` },
            { k: 'tv', n: `剧集/综艺/动漫` },
          ] as { k: Tab, n: string }[]).map(t => (
            <button key={t.k}
              onClick={() => setTab(t.k)}
              className={`px-3 py-1.5 text-xs rounded-lg transition ${
                tab === t.k
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}>
              {t.n}
            </button>
          ))}
        </div>
      </div>

      {/* Grid - 2026-08-03 调小: cols 3/4/5/6/7/8, gap-2 */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        {loading && items.length === 0 ? (
          <div className="text-center text-white/40 py-16">加载中...</div>
        ) : error && items.length === 0 ? (
          <div className="text-center text-red-400 py-16">
            <div>❌ 加载失败: {error}</div>
            <button onClick={() => setTab(tab)} className="mt-3 px-4 py-1.5 bg-violet-600 rounded text-sm">重试</button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center text-white/40 py-16">暂无数据</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
            {items.map(item => (
              <UpcomingCard key={`${item.tmdbType}-${item.tmdbId}`} item={item} />
            ))}
          </div>
        )}

        {/* 加载中但有旧数据时, 顶部显示进度条 */}
        {loading && items.length > 0 && (
          <div className="fixed top-0 left-0 right-0 h-0.5 bg-violet-500/50 z-50">
            <div className="h-full bg-violet-500 animate-pulse" style={{ width: '60%' }}></div>
          </div>
        )}

        {/* 错误提示但有旧数据时, 顶部显示 */}
        {error && items.length > 0 && (
          <div className="fixed top-14 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-red-500/90 text-white text-xs rounded z-50">
            刷新失败: {error} (显示上次数据)
          </div>
        )}
      </div>
    </div>
  );
}

function UpcomingCard({ item }: { item: UpcomingItem }) {
  const router = useRouter();
  const onClick = () => {
    if (item.hasMatch && item.matchedResourceId) {
      // 已匹配 → 跳详情页
      router.push(`/tmdb/${item.tmdbType}/${item.tmdbId}`);
    } else {
      // 未匹配 → 跳待上传详情页 (xx_upcoming.id 是 int 主键)
      router.push(`/upcoming/${item.id}`);
    }
  };

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer relative overflow-hidden rounded-md bg-white/5 hover:bg-white/10 transition"
    >
      {/* Poster */}
      <div className="aspect-[2/3] bg-gradient-to-br from-violet-900/30 to-pink-900/30 relative">
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

        {/* 状态角标 - 缩小 */}
        <div className="absolute top-1 left-1 flex flex-col gap-0.5">
          {item.tmdbType === 'tv' ? (
            <span className="px-1 py-0.5 bg-cyan-600/90 text-[9px] rounded">剧集</span>
          ) : (
            <span className="px-1 py-0.5 bg-violet-600/90 text-[9px] rounded">电影</span>
          )}
          {!item.hasMatch && (
            <span className="px-1 py-0.5 bg-amber-500/90 text-black text-[9px] rounded font-semibold">📤 待上传</span>
          )}
          {item.hasMatch && (
            <span className="px-1 py-0.5 bg-emerald-600/90 text-white text-[9px] rounded">✓ 已匹配</span>
          )}
        </div>

        {/* 评分 */}
        {item.voteAverage && item.voteAverage > 0 && (
          <div className="absolute top-1 right-1 px-1 py-0.5 bg-black/70 text-amber-400 text-[9px] rounded">
            ⭐ {item.voteAverage.toFixed(1)}
          </div>
        )}
      </div>

      {/* Info - 缩 padding */}
      <div className="p-1.5">
        <div className="text-[11px] font-semibold truncate" title={item.title}>{item.title}</div>
        <div className="text-[9px] text-white/40 mt-0.5 flex items-center gap-1">
          <span>📅 {item.releaseDate}</span>
          {item.hasMatch && item.matchedSource && (
            <span className="px-1 bg-emerald-500/20 text-emerald-300 rounded text-[8px]">{item.matchedSource}</span>
          )}
        </div>
      </div>
    </div>
  );
}
