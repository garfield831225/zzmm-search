'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useRequireAuth } from '@/lib/use-require-auth';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

interface ThemeItem {
  itemId: number;
  tmdbId: number;
  tmdbType: string;
  title: string;
  originalTitle: string | null;
  releaseDate: string | null;
  posterPath: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  voteAverage: number | null;
  overview: string | null;
  sortOrder: number;
}

interface Theme {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  items: ThemeItem[];
}

export default function ThemesPage() {
  // 2026-08-15: 鉴权 (替代不跑的 middleware) - 所有 hooks 提前, 早期 return 放最后
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const hasLoadedRef = useRef(false);
  const { isReady } = useRequireAuth('/themes');

  if (!isReady) {
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/50 text-sm">加载中...</div>;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchData = async () => {
      for (let i = 0; i < 2; i++) {
        if (cancelled) return;
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 20000);
          const r = await fetch(`/api/themes?_t=${Date.now()}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' },
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          if (cancelled) return;
          setThemes(d.themes || []);
          setLoading(false);
          setError(null);
          hasLoadedRef.current = true;
          return;
        } catch (e: any) {
          if (i === 1) {
            if (!cancelled) {
              setError(e?.message || '加载失败');
              setLoading(false);
            }
          } else {
            await new Promise(r => setTimeout(r, 800));
          }
        }
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [pathname]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gradient-to-b from-[#0a0a0f] to-[#0a0a0f]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/60 hover:text-white text-sm">← 返回首页</Link>
            <h1 className="text-lg font-bold">🎬 主题专区</h1>
          </div>
          <div className="text-xs text-white/40">共 {themes.length} 个主题 · admin 后台管理</div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {loading && themes.length === 0 ? (
          <div className="text-center text-white/40 py-16">加载中...</div>
        ) : error && themes.length === 0 ? (
          <div className="text-center text-red-400 py-16">
            <div>❌ 加载失败: {error}</div>
          </div>
        ) : themes.length === 0 ? (
          <div className="text-center text-white/40 py-16">
            <div className="mb-3">暂无主题</div>
            <div className="text-xs">admin 后台 → 主题专区 → 创建主题</div>
          </div>
        ) : (
          <div className="space-y-8">
            {themes.map(theme => (
              <ThemeSection key={theme.id} theme={theme} />
            ))}
          </div>
        )}

        {loading && themes.length > 0 && (
          <div className="fixed top-0 left-0 right-0 h-0.5 bg-cyan-500/50 z-50">
            <div className="h-full bg-cyan-500 animate-pulse" style={{ width: '60%' }}></div>
          </div>
        )}
      </div>
    </div>
  );
}

function ThemeSection({ theme }: { theme: Theme }) {
  return (
    <section>
      {/* 主题标题 */}
      <div className="flex items-center gap-3 mb-3 pb-2 border-b border-white/10">
        <h2 className="text-base font-bold text-white">{theme.name}</h2>
        <span className="text-[10px] text-white/40">/{theme.slug}</span>
        <span className="text-[10px] text-white/40 ml-auto">{theme.items.length} 部</span>
      </div>

      {theme.items.length === 0 ? (
        <div className="text-center text-white/30 py-8 text-xs bg-white/5 rounded-lg">
          主题下暂无内容, admin 后台加
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
          {theme.items.map(item => (
            <ThemeItemCard key={item.itemId} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ThemeItemCard({ item }: { item: ThemeItem }) {
  const router = useRouter();
  const onClick = () => {
    if (item.tmdbType === 'movie' || item.tmdbType === 'tv') {
      router.push(`/tmdb/${item.tmdbType}/${item.tmdbId}`);
    }
  };

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer relative overflow-hidden rounded-md bg-white/5 hover:bg-white/10 transition"
    >
      <div className="aspect-[2/3] bg-gradient-to-br from-cyan-900/30 to-blue-900/30 relative">
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

        {/* 角标: 类型 */}
        <div className="absolute top-1 left-1">
          {item.tmdbType === 'tv' ? (
            <span className="px-1 py-0.5 bg-cyan-600/90 text-[9px] rounded">剧集</span>
          ) : item.tmdbType === 'movie' ? (
            <span className="px-1 py-0.5 bg-violet-600/90 text-[9px] rounded">电影</span>
          ) : (
            <span className="px-1 py-0.5 bg-white/20 text-[9px] rounded">?</span>
          )}
        </div>

        {/* 评分 */}
        {item.voteAverage && item.voteAverage > 0 && (
          <div className="absolute top-1 right-1 px-1 py-0.5 bg-black/70 text-amber-400 text-[9px] rounded">
            ⭐ {item.voteAverage.toFixed(1)}
          </div>
        )}
      </div>

      <div className="p-1.5">
        <div className="text-[11px] font-semibold truncate" title={item.title}>{item.title}</div>
        {item.releaseDate && (
          <div className="text-[9px] text-white/40 mt-0.5">📅 {item.releaseDate}</div>
        )}
      </div>
    </div>
  );
}
