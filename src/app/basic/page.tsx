'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

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
}

type Tab = 'all' | 'movie' | 'tv';

export default function BasicPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [items, setItems] = useState<BasicItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchData = async () => {
      for (let i = 0; i < 3; i++) {
        if (cancelled) return;
        try {
          // 2026-08-12 修: 不再带 Cache-Control: no-store + Pragma: no-cache 这俩 header
          //   带这俩 header 会让 NAS nginx 卡死 (curl 5s+ 不返回, page 25s "加载中..." 不消失)
          //   只用 cache: 'no-store' 就够了, 浏览器自动不缓存
          const r = await fetch(`/api/basic?type=${tab}&pageSize=60&_t=${Date.now()}`, {
            cache: 'no-store',
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
  }, [tab, pathname]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gradient-to-b from-[#0a0a0f] to-[#0a0a0f]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/60 hover:text-white text-sm">← 返回首页</Link>
            <h1 className="text-lg font-bold">👑 泽泽妈 115 文档专区 (按上映时间近→远)</h1>
          </div>
          <div className="text-xs text-white/40">共 {total} 部 · import_channel=zezhe</div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 pb-3 flex gap-2">
          {([
            { k: 'all', n: `全部 (${total})` },
            { k: 'movie', n: `电影` },
            { k: 'tv', n: `剧集/动漫/综艺` },
          ] as { k: Tab, n: string }[]).map(t => (
            <button key={t.k}
              onClick={() => setTab(t.k)}
              className={`px-3 py-1.5 text-xs rounded-lg transition ${
                tab === t.k
                  ? 'bg-pink-600 text-white'
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
            <button onClick={() => setTab(tab)} className="mt-3 px-4 py-1.5 bg-pink-600 rounded text-sm">重试</button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center text-white/40 py-16">暂无数据</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
            {items.map(item => (
              <BasicCard key={`${item.tmdbType}-${item.tmdbId}`} item={item} />
            ))}
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
    // 跳详情页 (movie 跟 tv 都走 /tmdb/[type]/[id])
    if (item.tmdbType === 'movie' || item.tmdbType === 'tv') {
      router.push(`/tmdb/${item.tmdbType}/${item.tmdbId}`);
    } else {
      // 兜底跳资源 id
      router.push(`/library?id=${item.resourceId}`);
    }
  };

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer relative overflow-hidden rounded-md bg-white/5 hover:bg-white/10 transition"
    >
      {/* Poster */}
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

        {/* 角标: 类型 + 多网盘 */}
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
        </div>

        {/* 评分 */}
        {item.voteAverage && item.voteAverage > 0 && (
          <div className="absolute top-1 right-1 px-1 py-0.5 bg-black/70 text-amber-400 text-[9px] rounded">
            ⭐ {item.voteAverage.toFixed(1)}
          </div>
        )}
      </div>

      {/* Info */}
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
