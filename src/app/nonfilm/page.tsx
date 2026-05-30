'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMAGE_FALLBACK = 'https://image.tmdb.org/t/p/w500/7bUqJAuI5LFiJ6xMcLQ2E3YL8w1a.jpg';

const NONFILM_CATEGORIES = ['全部', '音乐', '体育', '游戏', '电子书', '精品课', '文档'];
const SOURCES = ['全部', '115网盘', '百度网盘', '阿里云盘', '磁力链接', 'ed2k链接'];

const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k',
};
const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'aliyun': '阿里云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接',
};

interface DownloadToast {
  id: number;
  type: 'success' | 'cooldown' | 'limit' | 'banned' | 'error' | 'copy';
  message: string;
}

interface ResourceItem {
  id: number;
  name: string;
  link: string;
  linkCode: string;
  source: string;
  sourceKey: string;
  category: string;
  size: string;
  tags: string[];
  formatTags: string[];
  musicCover: { artist: string; album: string; cover_url: string } | null;
}

// 从文件名提取格式标签
function extractFormatTags(name: string): string[] {
  const patterns = [
    'FLAC', 'ALAC', 'WAV', 'APE', 'AIFF', 'DSD', 'DSF', 'DFF',
    '24bit', '32bit', '16bit', '48kHz', '96kHz', '192kHz', '44.1kHz',
    'Hi-Res', 'HR', 'SACD', 'DVD', 'BD', 'ISO', 'MKV', 'MP4',
    'AAC', 'OGG', 'WMA', 'M4A', 'APE', 'TTA', 'TAK', 'SPMONLY',
    'LIVE', 'LIVE版', '演唱会', '录音室', 'Studio',
  ];
  const found: string[] = [];
  const upper = name.toUpperCase();
  for (const p of patterns) {
    if (upper.includes(p.toUpperCase())) found.push(p);
  }
  return found.slice(0, 5);
}

export default function NonFilmPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [source, setSource] = useState('全部');
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ResourceItem | null>(null);
  const [toasts, setToasts] = useState<DownloadToast[]>([]);
  let toastCounter = 0;

  const addToast = useCallback((type: DownloadToast['type'], message: string) => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const isMagnetOrEd2k = (link: string) =>
    link?.startsWith('magnet:') || link?.startsWith('ed2k://');

  const handleCopyLink = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      addToast('copy', '已复制到剪贴板');
    } catch {
      addToast('error', '复制失败，请手动复制');
    }
  }, [addToast]);

  const handleDownload = useCallback(async (resourceId: number) => {
    const token = localStorage.getItem('token');
    if (!token) { addToast('error', '请先登录'); return; }
    try {
      const res = await fetch(`/api/download?id=${resourceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success && data.url) {
        addToast('success', '下载链接已就绪，正在跳转...');
        setTimeout(() => window.open(data.url, '_blank'), 800);
      } else {
        addToast('error', data.message || '下载失败');
      }
    } catch {
      addToast('error', '网络错误，请重试');
    }
  }, [addToast]);

  const fetchItems = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p.toString(), pageSize: '30', category, zone: 'nonfilm' });
      if (query) params.set('q', query);
      if (source !== '全部') params.set('source', source);

      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      const mapped = (data.items || []).map((item: any) => ({
        ...item,
        formatTags: extractFormatTags(item.name),
        musicCover: item.musicCover || null,
      }));
      setItems(p === 1 ? mapped : [...items, ...mapped]);
      setTotal(data.total);
      setPage(p);
    } catch {}
    setLoading(false);
  }, [query, category, source, items]);

  useEffect(() => { fetchItems(1); }, [category, source]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Link href="/" className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center">
                <span className="text-xl">🎵</span>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900">非影视区</h1>
                <p className="text-xs text-gray-500">音乐/体育/文档等资源 · 共 {total.toLocaleString()} 条</p>
              </div>
            </div>
            <Link href="/" className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition">
              ← 影视区
            </Link>
          </div>

          {/* Search */}
          <div className="relative flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchItems(1); }}
              placeholder="搜索音乐、体育、文档..."
              className="flex-1 bg-white border border-gray-200 rounded-xl px-5 py-3 pl-12 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition shadow-sm"
            />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">🔍</span>
            <button
              onClick={() => fetchItems(1)}
              className="px-5 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl text-white font-medium transition shadow-sm"
            >
              搜索
            </button>
          </div>

          {/* Category filters */}
          <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
            {NONFILM_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition shadow-sm ${
                  category === cat
                    ? 'bg-cyan-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Source filters */}
          <div className="flex gap-2 mt-2 overflow-x-auto">
            {SOURCES.map((src) => (
              <button
                key={src}
                onClick={() => setSource(src)}
                className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition shadow-sm ${
                  source === src
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {src}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="group cursor-pointer bg-white rounded-xl shadow-sm hover:shadow-md transition overflow-hidden"
              onClick={() => setSelectedItem(item)}
            >
              {/* Poster / Icon */}
              <div className="relative aspect-square bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center overflow-hidden">
                {item.musicCover?.cover_url ? (
                  <img src={item.musicCover.cover_url} alt={item.musicCover.album}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
                ) : (
                  <span className="text-5xl">🎵</span>
                )}
                <div className="absolute top-2 right-2">
                  <span className="px-2 py-0.5 bg-cyan-600 text-white text-xs rounded">{item.source}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isMagnetOrEd2k(item.link)) handleCopyLink(item.link);
                    else handleDownload(item.id);
                  }}
                  className="absolute bottom-2 right-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium opacity-0 group-hover:opacity-100 transition shadow text-white flex items-center gap-1"
                >
                  {isMagnetOrEd2k(item.link) ? '📋 复制' : '⬇ 下载'}
                </button>
              </div>

              {/* Info */}
              <div className="p-3">
                <h3 className="font-medium text-sm line-clamp-2 leading-tight text-gray-900">{item.name}</h3>
                {item.formatTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.formatTags.map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 bg-cyan-100 text-cyan-700 text-xs rounded">{tag}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                  <span>{item.category}</span>
                  {item.size && <span>📦 {item.size}</span>}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Load More */}
        {items.length < total && (
          <div className="flex justify-center mt-8">
            <button
              onClick={() => fetchItems(page + 1)}
              disabled={loading}
              className="px-8 py-3 bg-white hover:bg-gray-100 border border-gray-200 rounded-xl disabled:opacity-50 transition shadow-sm text-gray-700"
            >
              {loading ? '加载中...' : `加载更多 (${total - items.length} 条)`}
            </button>
          </div>
        )}
      </main>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selectedItem.name}</h2>
                    <div className="flex flex-wrap gap-2 text-sm text-gray-500 mt-1">
                      <span className="px-2 py-1 bg-cyan-100 text-cyan-700 rounded">{selectedItem.category}</span>
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">{selectedItem.source}</span>
                    </div>
                  </div>
                  <button onClick={() => setSelectedItem(null)} className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-400">✕</button>
                </div>

                {selectedItem.formatTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {selectedItem.formatTags.map((tag) => (
                      <span key={tag} className="px-3 py-1 bg-cyan-100 text-cyan-700 rounded-full text-sm">{tag}</span>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    if (isMagnetOrEd2k(selectedItem.link)) handleCopyLink(selectedItem.link);
                    else handleDownload(selectedItem.id);
                  }}
                  className="w-full flex items-center justify-center gap-2 p-4 bg-cyan-600 hover:bg-cyan-500 rounded-xl transition text-white font-medium shadow-sm"
                >
                  {isMagnetOrEd2k(selectedItem.link) ? '📋 复制链接' : '⬇ 立即下载'}
                  {selectedItem.linkCode && !isMagnetOrEd2k(selectedItem.link) && (
                    <span className="text-cyan-200 text-sm">提取码：{selectedItem.linkCode}</span>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: -60, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -60, scale: 0.9 }}
              className={`px-5 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 min-w-[180px] ${
                toast.type === 'copy' || toast.type === 'success' ? 'bg-green-600 text-white' :
                toast.type === 'cooldown' ? 'bg-orange-500 text-white' :
                toast.type === 'limit' ? 'bg-blue-500 text-white' :
                toast.type === 'banned' ? 'bg-red-700 text-white' :
                'bg-red-500 text-white'
              }`}
            >
              {toast.type === 'copy' ? '📋' : toast.type === 'success' ? '✓' : '✕'} {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}