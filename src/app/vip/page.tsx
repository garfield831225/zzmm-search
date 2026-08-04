'use client';

import { useState, useEffect, Component, ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// 2026-08-04: 客户端错误捕获 (用户报告 /vip 报 "Application error")
class VipErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; err?: string }> {
  constructor(p: any) { super(p); this.state = { hasError: false }; }
  static getDerivedStateFromError(err: Error) { return { hasError: true, err: err.message }; }
  componentDidCatch(err: Error, info: any) {
    console.error('[vip-error]', err, info);
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

interface VipItem {
  resourceId: number;
  tmdbId: string;
  tmdbType: 'movie' | 'tv' | null;
  title: string;
  originalTitle: string | null;
  releaseDate: string;
  posterUrl: string | null;
  voteAverage: number | null;
  source: string;
  resourceCount: number;
}

type Tab = 'all' | 'movie' | 'tv';

export default function VipPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [items, setItems] = useState<VipItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 2026-08-04: 简化 useEffect, 只依赖 tab (去掉 pathname 避免误触发)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/vip?type=${tab}&pageSize=30&_t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-store' },
    })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(d => {
        if (cancelled) return;
        setItems(Array.isArray(d.items) ? d.items : []);
        setTotal(typeof d.total === 'number' ? d.total : 0);
        setError(null);
        setLoading(false);
      })
      .catch(e => {
        if (!cancelled) {
          setError(e?.message || '加载失败');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [tab]);

  return (
    <VipErrorBoundary>
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-gradient-to-b from-[#0a0a0f] to-[#0a0a0f]/95 backdrop-blur border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-white/60 hover:text-white text-sm">← 返回首页</Link>
              <h1 className="text-lg font-bold">💎 VIP 专区 (按上映时间近→远)</h1>
            </div>
            <div className="text-xs text-white/40">共 {total} 部 · access_level=vip</div>
          </div>

          {/* Tabs */}
          <div className="max-w-7xl mx-auto px-4 pb-3 flex gap-2">
            {([
              { k: 'all' as Tab, n: `全部 (${total})` },
              { k: 'movie' as Tab, n: '电影' },
              { k: 'tv' as Tab, n: '剧集/动漫/综艺' },
            ]).map(t => (
              <button key={t.k}
                onClick={() => setTab(t.k)}
                className={`px-3 py-1.5 text-xs rounded-lg transition ${
                  tab === t.k
                    ? 'bg-amber-600 text-white'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}>
                {t.n}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="max-w-7xl mx-auto px-4 py-4">
          {loading && items.length === 0 ? (
            <div className="text-center text-white/40 py-16">加载中...</div>
          ) : error && items.length === 0 ? (
            <div className="text-center text-red-400 py-16">
              <div>❌ 加载失败: {error}</div>
              <button onClick={() => setTab(tab)} className="mt-3 px-4 py-1.5 bg-amber-600 rounded text-sm">重试</button>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-white/40 py-16">暂无数据</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
              {items.map(item => (
                <VipCard key={item.resourceId + '-' + item.tmdbId} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </VipErrorBoundary>
  );
}

function VipCard({ item }: { item: VipItem }) {
  const router = useRouter();
  const onClick = () => {
    try {
      if (item.tmdbType === 'movie' || item.tmdbType === 'tv') {
        router.push('/tmdb/' + item.tmdbType + '/' + item.tmdbId);
      } else {
        router.push('/library?id=' + item.resourceId);
      }
    } catch (e) {
      console.error('[vip-card-click-err]', e);
    }
  };

  const source = (item.source || '').replace(/ \[deleted\]$/, '');

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer relative overflow-hidden rounded-md bg-white/5 hover:bg-white/10 transition"
    >
      {/* Poster */}
      <div className="aspect-[2/3] bg-gradient-to-br from-amber-900/30 to-yellow-900/30 relative">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title || ''}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e: any) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20 text-2xl">🎬</div>
        )}

        {/* 角标 */}
        <div className="absolute top-1 left-1 flex flex-col gap-0.5">
          {item.tmdbType === 'tv' ? (
            <span className="px-1 py-0.5 bg-cyan-600/90 text-[9px] rounded">剧集</span>
          ) : item.tmdbType === 'movie' ? (
            <span className="px-1 py-0.5 bg-violet-600/90 text-[9px] rounded">电影</span>
          ) : (
            <span className="px-1 py-0.5 bg-white/20 text-[9px] rounded">未分类</span>
          )}
          {item.resourceCount > 1 && (
            <span className="px-1 py-0.5 bg-amber-500/90 text-black text-[9px] rounded font-semibold">📦 {item.resourceCount} 网盘</span>
          )}
          <span className="px-1 py-0.5 bg-gradient-to-r from-amber-500 to-yellow-500 text-black text-[9px] rounded font-bold">💎 VIP</span>
        </div>

        {/* 评分 */}
        {item.voteAverage != null && item.voteAverage > 0 && (
          <div className="absolute top-1 right-1 px-1 py-0.5 bg-black/70 text-amber-400 text-[9px] rounded">
            ⭐ {item.voteAverage.toFixed(1)}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-1.5">
        <div className="text-[11px] font-semibold truncate" title={item.title}>{item.title || '未命名'}</div>
        <div className="text-[9px] text-white/40 mt-0.5 flex items-center gap-1">
          <span>📅 {item.releaseDate || '?'}</span>
          {source && (
            <span className="px-1 bg-amber-500/20 text-amber-300 rounded text-[8px]">{source}</span>
          )}
        </div>
      </div>
    </div>
  );
}
