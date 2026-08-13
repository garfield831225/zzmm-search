'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Star, Tv, Film, Loader2, ExternalLink, AlertCircle } from 'lucide-react';

type Provider = 'netflix' | 'prime' | 'disney' | 'appletv' | 'crunchyroll';
type Region = 'US' | 'ES' | 'GB' | 'MX' | 'AR' | 'CO' | 'DE' | 'FR' | 'BR' | 'IT';
type MediaType = 'movie' | 'tv';

interface ChartItem {
  id: number;
  type: string;
  title: string;
  posterPath: string | null;
  voteAverage: number;
  releaseDate: string;
  localResourceCount: number;
  localSources: string[];
}

const PROVIDERS: { id: Provider; name: string; emoji: string; color: string }[] = [
  { id: 'netflix', name: 'Netflix', emoji: '🟥', color: 'from-red-600 to-red-500' },
  { id: 'prime', name: 'Prime Video', emoji: '🟦', color: 'from-blue-600 to-cyan-500' },
  { id: 'disney', name: 'Disney+', emoji: '🟪', color: 'from-indigo-600 to-violet-500' },
  { id: 'appletv', name: 'Apple TV+', emoji: '⬛', color: 'from-slate-700 to-slate-500' },
  { id: 'crunchyroll', name: 'Crunchyroll', emoji: '🟧', color: 'from-orange-600 to-amber-500' },
];

const REGIONS: { id: Region; flag: string }[] = [
  { id: 'US', flag: '🇺🇸' },
  { id: 'GB', flag: '🇬🇧' },
  { id: 'ES', flag: '🇪🇸' },
  { id: 'MX', flag: '🇲🇽' },
  { id: 'AR', flag: '🇦🇷' },
  { id: 'CO', flag: '🇨🇴' },
  { id: 'DE', flag: '🇩🇪' },
  { id: 'FR', flag: '🇫🇷' },
  { id: 'BR', flag: '🇧🇷' },
  { id: 'IT', flag: '🇮🇹' },
];

// 2026-08-14: 榜单区块
// - 5 平台 × 10 国家 × 2 type = 100 cache 组合
// - 卡片: 海报 + 标题 + 评分 + 本地资源数 + 来源
// - 关联 xx_resources: localResourceCount > 0 显示"本地 N 网盘"
export default function ChartsSection() {
  const [provider, setProvider] = useState<Provider>('netflix');
  const [region, setRegion] = useState<Region>('US');
  const [mediaType, setMediaType] = useState<MediaType>('movie');
  const [items, setItems] = useState<ChartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/charts?provider=${provider}&region=${region}&type=${mediaType}&page=1`;
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data?.error?.message || `HTTP ${r.status}`);
        }
        const data = await r.json();
        if (cancelled) return;
        setItems(data.items || []);
        setCachedAt(data.cachedAt || null);
      } catch (e: any) {
        if (!cancelled) setError(e.message || '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [provider, region, mediaType]);

  return (
    <div className="space-y-4">
      {/* 平台切换 */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => setProvider(p.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition shrink-0 flex items-center gap-1.5 ${
              provider === p.id
                ? `bg-gradient-to-r ${p.color} text-white shadow-[0_0_12px_rgba(168,85,247,0.25)]`
                : 'bg-white/[0.04] text-white/60 hover:text-white/90 hover:bg-white/[0.08] border border-white/[0.06]'
            }`}
          >
            <span>{p.emoji}</span>
            <span>{p.name}</span>
          </button>
        ))}
      </div>

      {/* 国家 + 类型切换 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide flex-1 min-w-0">
          {REGIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => setRegion(r.id)}
              className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition shrink-0 ${
                region === r.id
                  ? 'bg-violet-500/30 text-white border border-violet-400/50'
                  : 'bg-white/[0.03] text-white/50 hover:text-white/80 border border-white/[0.05]'
              }`}
            >
              {r.flag} {r.id}
            </button>
          ))}
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setMediaType('movie')}
            className={`px-2.5 py-1 rounded-lg text-xs transition flex items-center gap-1 ${
              mediaType === 'movie' ? 'bg-cyan-500/30 text-white border border-cyan-400/50' : 'bg-white/[0.03] text-white/50 hover:text-white/80 border border-white/[0.05]'
            }`}
          >
            <Film size={12} /> 电影
          </button>
          <button
            onClick={() => setMediaType('tv')}
            className={`px-2.5 py-1 rounded-lg text-xs transition flex items-center gap-1 ${
              mediaType === 'tv' ? 'bg-cyan-500/30 text-white border border-cyan-400/50' : 'bg-white/[0.03] text-white/50 hover:text-white/80 border border-white/[0.05]'
            }`}
          >
            <Tv size={12} /> 剧集
          </button>
        </div>
      </div>

      {/* 缓存状态 */}
      {cachedAt && !loading && (
        <div className="text-[10px] text-white/30 text-right">
          缓存于 {new Date(cachedAt).toLocaleString('zh-CN', { hour12: false })}
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-300 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-red-200">
            <div className="font-medium">加载失败</div>
            <div className="text-xs text-red-200/70 mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {/* 加载状态 */}
      {loading && (
        <div className="flex items-center justify-center py-12 gap-2 text-white/50">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">加载中…</span>
        </div>
      )}

      {/* 卡片网格 */}
      {!loading && !error && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {items.map((it) => (
            <Link
              key={`${it.type}-${it.id}`}
              href={`/tmdb/${it.type}/${it.id}`}
              className="group block rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-violet-400/40 hover:bg-white/[0.04] transition overflow-hidden"
            >
              <div className="relative aspect-[2/3] bg-white/[0.04]">
                {it.posterPath ? (
                  <img
                    src={it.posterPath}
                    alt={it.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">无图</div>
                )}
                {it.localResourceCount > 0 && (
                  <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-emerald-500/95 text-white text-[10px] font-bold rounded-md flex items-center gap-1 shadow-lg">
                    <ExternalLink size={9} />{it.localResourceCount} 网盘
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <div className="flex items-center gap-1 text-yellow-400 text-[10px] font-bold">
                    <Star size={10} className="fill-current" />
                    {it.voteAverage > 0 ? it.voteAverage.toFixed(1) : 'N/A'}
                  </div>
                </div>
              </div>
              <div className="p-2">
                <div className="text-xs font-medium text-white/90 line-clamp-2 leading-snug min-h-[2.2em]">
                  {it.title}
                </div>
                <div className="text-[10px] text-white/40 mt-0.5">
                  {it.releaseDate ? it.releaseDate.slice(0, 4) : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {!loading && !error && items.length === 0 && (
        <div className="text-center py-12 text-white/40 text-sm">
          暂无数据
        </div>
      )}
    </div>
  );
}
