'use client';

import { useState, useEffect, useCallback } from 'react';

interface CatalogItem {
  id: number;
  name: string;
  category: string;
  tags: string[];
  docSheet?: string;
  subType?: string;
  createdAt: string;
  importChannel?: string;
  poster: string | null;
  voteAverage: number | null;
  releaseDate: string | null;
  tmdbStatus: string | null;
}

// 跟主页面完全隔离: 没有 header 导航, 没有"返回首页"链接, 不显示任何网盘/磁力链接
export default function TitlesPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('全部');
  const [categories, setCategories] = useState<string[]>(['全部']);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const fetchItems = useCallback(async (p = 1, reset = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: p.toString(),
        pageSize: pageSize.toString(),
      });
      if (query) params.set('q', query);
      if (category !== '全部') params.set('category', category);
      const res = await fetch(`/api/catalog?${params}`);
      const data = await res.json();
      if (data.categories) setCategories(['全部', ...data.categories]);
      if (reset) setItems(data.items || []);
      else setItems(prev => [...prev, ...(data.items || [])]);
      setTotal(data.total || 0);
      setPage(p);
      setHasMore((p * pageSize) < (data.total || 0));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [query, category, pageSize]);

  useEffect(() => { fetchItems(1, true); }, [query, category]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchItems(1, true);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* 顶部 — 极简, 不含任何跳转主页的链接 */}
      <header className="border-b border-white/5 bg-[#12121a]/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-xl">
              📑
            </div>
            <div>
              <h1 className="text-lg font-bold">资源目录</h1>
              <p className="text-xs text-white/40">共 {total.toLocaleString()} 个资源</p>
            </div>
          </div>
          {/* 不放任何跳转主页的链接 — 保持页面独立 */}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 搜索 + 分类 */}
        <div className="mb-6 space-y-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索标题..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-semibold hover:opacity-90"
            >
              搜索
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${
                  category === c
                    ? 'bg-gradient-to-r from-violet-600 to-pink-600 text-white'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* 列表 — 纯标题 + 分类 + 封面, 不显示任何 link */}
        {loading && items.length === 0 ? (
          <div className="text-center py-12 text-white/40">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-white/40">暂无数据</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {items.map(item => (
              <div
                key={item.id}
                className="bg-white/5 border border-white/5 rounded-xl overflow-hidden hover:border-white/20 transition"
              >
                {/* 封面 */}
                {item.poster ? (
                  <img
                    src={item.poster}
                    alt={item.name}
                    className="w-full aspect-[2/3] object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] bg-gradient-to-br from-violet-500/20 to-pink-500/20 flex items-center justify-center text-4xl">
                    🎬
                  </div>
                )}

                {/* 标题 + 分类 */}
                <div className="p-3">
                  <h3 className="text-sm font-medium line-clamp-2 mb-1" title={item.name}>
                    {item.name}
                  </h3>
                  <div className="flex items-center justify-between text-xs text-white/40">
                    <span className="px-2 py-0.5 bg-white/5 rounded">{item.category}</span>
                    {item.voteAverage && (
                      <span className="text-amber-400">★ {Number(item.voteAverage).toFixed(1)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 加载更多 */}
        {hasMore && (
          <div className="text-center mt-6">
            <button
              onClick={() => fetchItems(page + 1, false)}
              disabled={loading}
              className="px-6 py-2 bg-white/5 border border-white/10 rounded-xl text-white/60 hover:bg-white/10 disabled:opacity-50"
            >
              {loading ? '加载中...' : `加载更多 (${items.length}/${total})`}
            </button>
          </div>
        )}

        {/* 页脚 — 不放任何跳转主页的链接 */}
        <footer className="mt-12 text-center text-xs text-white/30">
          <p>共 {total.toLocaleString()} 条 · 第 {page} 页</p>
        </footer>
      </div>
    </div>
  );
}
