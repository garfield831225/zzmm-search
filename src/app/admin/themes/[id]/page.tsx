'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useParams, usePathname } from 'next/navigation';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

interface Theme {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  status: string;
  item_count: number;
}

interface Item {
  id: number;
  themeId: number;
  tmdbId: number;
  tmdbType: string;
  title: string;
  posterPath: string | null;
  posterUrl: string | null;
  backdropPath: string | null;
  backdropUrl: string | null;
  sortOrder: number;
  status: string;
  createdAt: string;
}

interface TmdbHit {
  tmdbId: number;
  tmdbType: string;
  title: string;
  originalTitle: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
  overview: string | null;
}

const TOKEN = () => typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || localStorage.getItem('adminToken') || localStorage.getItem('token') || '') : '';

export default function AdminThemeDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const themeId = parseInt(params.id);
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();

  // TMDB 搜索
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<TmdbHit[]>([]);
  const [addingId, setAddingId] = useState<number | null>(null);

  // 鉴权
  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u?.user_group !== 'admin' && u?.group !== 'admin') {
        router.push('/login?redirect=/admin/themes');
        return;
      }
      setAuthed(true);
      setChecking(false);
    } catch {
      router.push('/login?redirect=/admin/themes');
    }
  }, [router]);

  const loadTheme = async () => {
    const r = await fetch('/api/admin/themes', { headers: { Authorization: `Bearer ${TOKEN()}` } });
    const d = await r.json();
    const found = (d.themes || []).find((t: Theme) => t.id === themeId);
    if (found) setTheme(found);
  };

  const loadItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/themes/${themeId}/items`, { headers: { Authorization: `Bearer ${TOKEN()}` } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setItems(d.items || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authed && themeId) {
      loadTheme();
      loadItems();
    }
  }, [authed, themeId, pathname]);

  // TMDB 搜索 (debounce 500ms)
  useEffect(() => {
    if (!query.trim() || !authed) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/admin/tmdb-search?q=${encodeURIComponent(query)}&type=multi`, {
          headers: { Authorization: `Bearer ${TOKEN()}` },
        });
        const d = await r.json();
        if (r.ok) setHits(d.results || []);
      } catch {}
      setSearching(false);
    }, 500);
    return () => clearTimeout(t);
  }, [query, authed]);

  const addItem = async (hit: TmdbHit) => {
    setAddingId(hit.tmdbId);
    try {
      const r = await fetch(`/api/admin/themes/${themeId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({
          tmdb_id: hit.tmdbId,
          tmdb_type: hit.tmdbType,
          title: hit.title,
          poster_path: hit.posterPath,
          backdrop_path: hit.backdropPath,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        alert('添加失败: ' + (d.error || r.status));
        return;
      }
      await loadItems();
      await loadTheme();
    } catch (e: any) {
      alert('添加失败: ' + e.message);
    } finally {
      setAddingId(null);
    }
  };

  const deleteItem = async (itemId: number) => {
    if (!confirm('删除这个 item?')) return;
    try {
      const r = await fetch(`/api/admin/themes/${themeId}/items/${itemId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN()}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await loadItems();
      await loadTheme();
    } catch (e: any) {
      alert('删除失败: ' + e.message);
    }
  };

  const updateSort = async (itemId: number, newOrder: number) => {
    try {
      const r = await fetch(`/api/admin/themes/${themeId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({ sort_order: newOrder }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await loadItems();
    } catch (e: any) {
      alert('排序失败: ' + e.message);
    }
  };

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] text-white/40 text-sm">校验登录态...</div>;
  }
  if (!authed) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link href="/admin/themes" className="text-xs text-white/40 hover:text-white/60">← 返回主题列表</Link>
          <h1 className="text-2xl font-bold mt-1 flex items-center gap-3">
            🎬 主题内容管理
            {theme && <span className="text-base font-normal text-white/60">· {theme.name} <span className="text-xs font-mono">/{theme.slug}</span></span>}
          </h1>
        </div>

        {/* TMDB 搜索 */}
        <div className="bg-white/5 rounded-lg p-4 mb-6">
          <div className="text-sm font-semibold mb-2 text-cyan-300">🔍 TMDB 搜索加内容</div>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="输入片名 (中/英) — 0.5s 自动搜索"
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-sm"
          />
          {searching && <div className="text-xs text-white/40 mt-2">搜索中...</div>}
          {hits.length > 0 && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {hits.map(h => (
                <div key={`${h.tmdbType}-${h.tmdbId}`} className="bg-black/30 rounded overflow-hidden">
                  <div className="aspect-[2/3] bg-white/5 relative">
                    {h.posterPath ? (
                      <img src={`${TMDB_IMAGE_BASE}${h.posterPath}`} alt={h.title} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/20 text-2xl">🎬</div>
                    )}
                    <div className="absolute top-1 left-1">
                      {h.tmdbType === 'tv' ? (
                        <span className="px-1 py-0.5 bg-cyan-600/90 text-[9px] rounded">剧</span>
                      ) : (
                        <span className="px-1 py-0.5 bg-violet-600/90 text-[9px] rounded">影</span>
                      )}
                    </div>
                  </div>
                  <div className="p-1.5">
                    <div className="text-[11px] font-semibold truncate" title={h.title}>{h.title}</div>
                    <div className="text-[9px] text-white/40 mt-0.5">{h.releaseDate}</div>
                    <button
                      onClick={() => addItem(h)}
                      disabled={addingId === h.tmdbId}
                      className="mt-1 w-full px-2 py-0.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded text-[10px]">
                      {addingId === h.tmdbId ? '加中...' : '+ 加到主题'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 当前 items */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="text-sm font-semibold mb-3">📦 当前内容 ({items.length})</div>
          {loading ? (
            <div className="text-center text-white/40 py-8">加载中...</div>
          ) : items.length === 0 ? (
            <div className="text-center text-white/30 py-8 text-xs">该主题下还没内容, 上面搜一下加吧</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {items.map(item => (
                <div key={item.id} className="bg-black/30 rounded overflow-hidden relative group">
                  <div className="aspect-[2/3] bg-white/5">
                    {item.posterUrl ? (
                      <img src={item.posterUrl} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/20">🎬</div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-semibold truncate" title={item.title}>{item.title}</div>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[9px] text-white/40">排序</span>
                      <input
                        type="number"
                        defaultValue={item.sortOrder}
                        onBlur={e => {
                          const v = parseInt(e.target.value);
                          if (v !== item.sortOrder) updateSort(item.id, v);
                        }}
                        className="w-12 px-1 py-0.5 bg-black/40 border border-white/10 rounded text-[10px]"
                      />
                    </div>
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="mt-1 w-full px-2 py-0.5 bg-red-600/20 hover:bg-red-600/40 text-red-300 rounded text-[10px]">
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
