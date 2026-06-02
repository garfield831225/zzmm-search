'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

const ALL_CATEGORIES = ['全部', '电影', '剧集', '动漫', '少儿频道', '综艺', '纪录片', '音乐', '体育', '演唱会', '原盘', 'REMUX', '系列电影', '合集'];
const SOURCES = ['全部', '115网盘', '百度网盘', '阿里云盘', '夸克网盘', '123网盘', '天翼云盘', '磁力链接', 'ed2k链接', '迅雷链接'];
const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '夸克网盘': 'quark', '123网盘': '123', '天翼云盘': 'tianyi',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k', '迅雷链接': 'thunder',
};
const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};

const CAT_ICONS: Record<string, string> = {
  '电影': '🎬', '剧集': '📺', '动漫': '🈴', '少儿频道': '🧒', '综艺': '🎭',
  '纪录片': '📽️', '音乐': '🎵', '体育': '⚽',
  '演唱会': '🎤', '原盘': '💿', 'REMUX': '🔧', '系列电影': '🎞️', '合集': '📦',
};

interface Toast { id: number; type: 'success' | 'copy' | 'error'; message: string; }
interface Resource { id: number; name: string; link: string; link_code: string; source: string; category: string; size: string; }

export default function LibraryPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [source, setSource] = useState('全部');
  const [items, setItems] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  let toastCnt = 0;

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastCnt;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const isMagnetOrEd2k = (link: string) => link?.startsWith('magnet:') || link?.startsWith('ed2k://');

  const handleCopy = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      addToast('copy', '已复制到剪贴板');
    } catch { addToast('error', '复制失败'); }
  }, [addToast]);

  const fetchItems = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p.toString(), pageSize: pageSize.toString() });
      if (query) params.set('q', query);
      if (category !== '全部') params.set('category', category);
      if (source !== '全部') params.set('source', source);
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      setItems(p === 1 ? (data.items || []) : (prev: any[]) => [...prev, ...(data.items || [])]);
      setTotal(data.total || 0);
      setPage(p);
    } catch { addToast('error', '加载失败'); }
    finally { setLoading(false); }
  }, [query, category, source, pageSize, addToast]);

  useEffect(() => { fetchItems(1); }, [category, source]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); fetchItems(1); };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-8xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link href="/" className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-lg">📋</Link>
              <div>
                <h1 className="text-lg font-bold text-gray-900">资源库</h1>
                <p className="text-xs text-gray-400">全类型搜索 · {total.toLocaleString()} 条</p>
              </div>
            </div>
            <Link href="/" className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs transition text-gray-600">← 影视区</Link>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2 mb-3">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索任意资源名称..."
              className="flex-1 bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20"
            />
            <button type="submit" className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white transition">
              搜索
            </button>
          </form>

          {/* Category filter */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {ALL_CATEGORIES.map(cat => (
              <button key={cat} onClick={() => { setCategory(cat); setPage(1); }}
                className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition ${category === cat ? 'bg-violet-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100 border border-gray-200'}`}>
                {CAT_ICONS[cat] || '📁'} {cat}
              </button>
            ))}
          </div>

          {/* Source filter */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {SOURCES.map(src => (
              <button key={src} onClick={() => { setSource(src); setPage(1); }}
                className={`px-2.5 py-0.5 rounded text-xs whitespace-nowrap transition ${source === src ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-400 hover:text-gray-600'}`}>
                {src}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Table */}
      <main className="max-w-8xl mx-auto px-4 py-4">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          {/* Table header */}
          <div className="grid grid-cols-[80px_1fr_100px_100px_120px] gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div>分类</div>
            <div>名称</div>
            <div>来源</div>
            <div>大小</div>
            <div>操作</div>
          </div>

          {/* Table rows */}
          {items.map((item) => (
            <div key={item.id}
              className="grid grid-cols-[80px_1fr_100px_100px_120px] gap-2 px-4 py-2.5 border-b border-gray-100 hover:bg-violet-50/30 transition text-sm items-center group">
              <div>
                <span className="text-base">{CAT_ICONS[item.category] || '📁'}</span>
                <div className="text-xs text-gray-400">{item.category}</div>
              </div>
              <div className="min-w-0">
                <div className="text-gray-900 font-medium text-sm leading-snug line-clamp-2">{item.name}</div>
              </div>
              <div className="text-xs text-gray-500 truncate">{SOURCE_DISPLAY_MAP[item.source] || item.source}</div>
              <div className="text-xs text-gray-400">{item.size || '—'}</div>
              <div>
                <button
                  onClick={() => isMagnetOrEd2k(item.link) ? handleCopy(item.link) : handleCopy(item.link)}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs text-white font-medium transition opacity-0 group-hover:opacity-100 whitespace-nowrap"
                >
                  📋 复制链接
                </button>
              </div>
            </div>
          ))}

          {items.length === 0 && !loading && (
            <div className="py-16 text-center text-gray-400 text-sm">
              未找到资源，换个关键词试试
            </div>
          )}

          {loading && (
            <div className="py-8 text-center text-gray-400 text-sm">加载中...</div>
          )}
        </div>

        {/* Pagination */}
        {items.length < total && (
          <div className="flex justify-center mt-6">
            <button onClick={() => fetchItems(page + 1)} disabled={loading}
              className="px-8 py-3 bg-white hover:bg-gray-100 border border-gray-200 rounded-xl text-sm text-gray-700 disabled:opacity-50 transition shadow-sm">
              {loading ? '加载中...' : `加载更多 (剩余 ${(total - items.length).toLocaleString()} 条)`}
            </button>
          </div>
        )}

        <div className="text-center mt-3 text-xs text-gray-400">
          共 {total.toLocaleString()} 条，当前显示 {items.length.toLocaleString()} 条
        </div>
      </main>

      {/* Toast */}
      <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg ${t.type === 'copy' ? 'bg-green-600 text-white' : 'bg-red-500 text-white'}`}>
              {t.type === 'copy' ? '📋' : '✕'} {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
