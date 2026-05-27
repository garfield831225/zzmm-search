'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMAGE_FALLBACK = 'https://image.tmdb.org/t/p/w500/7bUqJAuI5LFiJ6xMcLQ2E3YL8w1a.jpg';

interface DownloadToast {
  id: number;
  type: 'success' | 'cooldown' | 'limit' | 'banned' | 'error';
  message: string;
}

const CATEGORIES = ['全部', '电影', '剧集', '动漫', '综艺', '音乐', '纪录片', '学习资料', '其他'];
const SOURCES = ['全部', '115网盘', '百度网盘', '阿里云盘', '夸克网盘', '123网盘', '天翼云盘', '磁力链接', 'ed2k链接', '迅雷链接'];

interface UserInfo {
  id: number;
  username: string;
  group: string;
  expire_at: string;
}

interface TmdbInfo {
  title: string;
  title_zh: string;
  poster_path: string;
  vote_average: string;
  overview: string;
  release_date: string;
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
  type: string;
  tags: string[];
  tmdbId: string;
  viewCount: number;
  tmdb: TmdbInfo | null;
  isCurrent?: boolean;
}

interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  items: ResourceItem[];
  categories: string[];
  sources: string[];
}

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [source, setSource] = useState('全部');
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ResourceItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [relatedItems, setRelatedItems] = useState<ResourceItem[]>([]);
  const [tmdbType, setTmdbType] = useState<string>('movie');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [mounted, setMounted] = useState(false);
  const [downloadToasts, setDownloadToasts] = useState<DownloadToast[]>([]);
  const [copyToasts, setCopyToasts] = useState<DownloadToast[]>([]);
  let toastCounter = 0;
  let copyToastCounter = 0;

  const addToast = useCallback((type: DownloadToast['type'], message: string) => {
    const id = ++toastCounter;
    setDownloadToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setDownloadToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const handleDownload = useCallback(async (resourceId: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const token = localStorage.getItem('token');
    if (!token) {
      addToast('error', '请先登录');
      return;
    }
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ resourceId }),
      });
      const data = await res.json();
      if (data.success && data.url) {
        addToast('success', '正在跳转...');
        setTimeout(() => window.open(data.url, '_blank'), 500);
      } else {
        addToast('error', data.message || '下载失败');
      }
    } catch {
      addToast('error', '网络错误，请重试');
    }
  }, [addToast]);

  const isMagnetOrEd2k = useCallback((link: string) => {
    return link?.startsWith('magnet:') || link?.startsWith('ed2k://');
  }, []);

  const addCopyToast = useCallback((msg: string) => {
    const id = ++copyToastCounter;
    setCopyToasts(prev => [...prev, { id, type: 'success', message: msg }]);
    setTimeout(() => setCopyToasts(prev => prev.filter(t => t.id !== id)), 2000);
  }, []);

  const handleCopyLink = useCallback(async (link: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(link);
      addCopyToast('已复制到剪贴板');
    } catch {
      addCopyToast('复制失败，请手动复制');
    }
  }, [addCopyToast]);

  // 从 localStorage 恢复登录状态
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem('user');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch {}
    }
  }, []);

  const fetchItems = useCallback(async (p = 1, currentItems?: ResourceItem[]) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p.toString(), pageSize: '30' });
      if (query) params.set('q', query);
      if (category !== '全部') params.set('category', category);
      if (source !== '全部') params.set('source', source);

      const res = await fetch(`/api/search?${params}`);
      const data: SearchResponse = await res.json();
      setItems(p === 1 ? data.items : [...(currentItems || items), ...data.items]);
      setTotal(data.total);
      setPage(p);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [query, category, source, items]);

  useEffect(() => {
    fetchItems(1);
  }, [category, source]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const handleItemClick = async (item: ResourceItem) => {
    setSelectedItem(item);
    setHistoryExpanded(false);
    if (item.tmdbId) {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/resource/${item.id}/related`);
        const data = await res.json();
        setRelatedItems(data.items || []);
        setTmdbType(data.tmdbType || 'movie');
      } catch {}
      setDetailLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0f]/95 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-pink-500 rounded-xl flex items-center justify-center">
                <span className="text-xl">🎬</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">泽泽妈妈资源库</h1>
                <p className="text-xs text-white/40">共 {total.toLocaleString()} 条资源</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {user ? (
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 bg-violet-600/30 rounded-lg text-sm text-violet-300">
                    {user.username}
                  </span>
                  <Link href="/nonfilm" className="px-3 py-1.5 bg-cyan-600/30 hover:bg-cyan-600/50 rounded-lg text-sm transition text-cyan-300">
                    🎵 非影视
                  </Link>
                  <Link href="/admin/codes" className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition">
                    查看卡密
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition"
                  >
                    退出
                  </button>
                  <Link href="/activate" className="px-3 py-1.5 bg-pink-600/50 hover:bg-pink-600 rounded-lg text-sm transition">
                    续费
                  </Link>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link href="/nonfilm" className="px-3 py-1.5 bg-cyan-600/30 hover:bg-cyan-600/50 rounded-lg text-sm transition text-cyan-300">
                    🎵 非影视
                  </Link>
                  <Link href="/login" className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition">
                    登录 / 注册
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchItems(1); }}
              placeholder="输入片名、类型、分类搜索..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-5 py-3 pl-12 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition"
            />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none">🔍</span>
            <button
              onClick={() => fetchItems(1)}
              className="px-5 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl text-white font-medium transition shrink-0"
            >
              搜索
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mt-4 overflow-x-auto pb-2 scrollbar-hide">
            <div className="flex gap-2 shrink-0">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition ${
                    category === cat
                      ? 'bg-violet-600 text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Source Filters */}
          <div className="flex gap-2 mt-2 overflow-x-auto pb-2 scrollbar-hide">
            <div className="flex gap-2 shrink-0">
              {SOURCES.map((src) => (
                <button
                  key={src}
                  onClick={() => setSource(src)}
                  className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition flex items-center gap-1 ${
                    source === src
                      ? 'bg-pink-600 text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  {src}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="group cursor-pointer"
              onClick={() => handleItemClick(item)}
            >
              {/* Poster */}
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-3">
                {item.tmdb?.poster_path ? (
                  <img
                    src={`${TMDB_IMAGE_BASE}${item.tmdb.poster_path}`}
                    alt={item.name}
                    className="w-full h-full object-cover transition group-hover:scale-105"
                    onError={(e) => { (e.target as HTMLImageElement).src = TMDB_IMAGE_FALLBACK; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl">
                    🎬
                  </div>
                )}

                {/* Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition" />

                {/* Tags */}
                <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                  {item.tags?.slice(0, 2).map((tag) => (
                    <span key={tag} className="px-2 py-0.5 bg-violet-600/80 text-xs rounded">
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Source Badge */}
                <div className="absolute top-2 right-2">
                  <span className="px-2 py-0.5 bg-pink-600/80 text-xs rounded">{item.source}</span>
                </div>

                {/* Rating */}
                {item.tmdb?.vote_average && (
                  <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 px-2 py-1 rounded text-xs">
                    <span className="text-yellow-400">★</span>
                    <span>{parseFloat(item.tmdb.vote_average).toFixed(1)}</span>
                  </div>
                )}

                {/* Download Button */}
                {isMagnetOrEd2k(item.link) ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopyLink(item.link, e); }}
                    className="absolute bottom-2 left-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium opacity-0 group-hover:opacity-100 transition flex items-center gap-1"
                  >
                    📋 复制链接
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(item.id, e); }}
                    className="absolute bottom-2 left-2 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-medium opacity-0 group-hover:opacity-100 transition flex items-center gap-1"
                  >
                    ⬇ 下载
                  </button>
                )}
              </div>

              {/* Info */}
              <div className="space-y-1">
                <h3 className="font-medium text-sm line-clamp-2 leading-tight">{item.name}</h3>
                <div className="flex items-center gap-2 text-xs text-white/40">
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
              onClick={() => fetchItems(page + 1, items)}
              disabled={loading}
              className="px-8 py-3 bg-white/10 hover:bg-white/20 rounded-xl disabled:opacity-50 transition"
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
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#12121a] rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col md:flex-row">
                {/* Poster */}
                <div className="w-full md:w-80 shrink-0">
                  <div className="aspect-[2/3] bg-white/5">
                    {selectedItem.tmdb?.poster_path ? (
                      <img
                        src={`${TMDB_IMAGE_BASE}${selectedItem.tmdb.poster_path}`}
                        alt={selectedItem.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-6xl">🎬</div>
                    )}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 p-6 overflow-y-auto max-h-[70vh]">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-2xl font-bold mb-2">{selectedItem.name}</h2>
                      <div className="flex flex-wrap gap-2 text-sm text-white/60">
                        <span className="px-2 py-1 bg-violet-600/30 rounded">{selectedItem.category}</span>
                        <span className="px-2 py-1 bg-pink-600/30 rounded">{selectedItem.source}</span>
                        {selectedItem.type && <span className="px-2 py-1 bg-white/10 rounded">{selectedItem.type}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedItem(null)}
                      className="p-2 hover:bg-white/10 rounded-lg transition"
                    >
                      ✕
                    </button>
                  </div>

                  {/* TMDB Info */}
                  {selectedItem.tmdb && (
                    <div className="mb-6 p-4 bg-white/5 rounded-xl">
                      <div className="flex items-center gap-4 mb-3">
                        {selectedItem.tmdb.vote_average && (
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold text-yellow-400">
                              {parseFloat(selectedItem.tmdb.vote_average).toFixed(1)}
                            </span>
                            <span className="text-white/40 text-sm">/ 10</span>
                          </div>
                        )}
                        {selectedItem.tmdb.release_date && (
                          <span className="text-white/60 text-sm">
                            {selectedItem.tmdb.release_date.slice(0, 4)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-white/70 leading-relaxed line-clamp-4">
                        {selectedItem.tmdb.overview}
                      </p>
                    </div>
                  )}

                  {/* Links */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-lg">📎 资源链接</h3>

                    {/* Current link */}
                    <div className="space-y-2">
                      <div className="text-xs text-white/40 mb-1">📌 当前版本</div>
                      {isMagnetOrEd2k(selectedItem.link) ? (
                        <button
                          onClick={(e) => { e.preventDefault(); handleCopyLink(selectedItem.link, e); }}
                          className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 rounded-xl transition group text-left"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xl">🔗</span>
                            <div>
                              <div className="font-medium">{selectedItem.source}</div>
                              <div className="text-sm text-cyan-400">磁力/ED2K链接，点击复制</div>
                            </div>
                          </div>
                          <span className="px-3 py-1 bg-cyan-600 rounded-lg text-sm opacity-0 group-hover:opacity-100 transition shrink-0">
                            📋 复制
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.preventDefault(); handleDownload(selectedItem.id, e); }}
                          className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 rounded-xl transition group text-left"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xl">🔗</span>
                            <div>
                              <div className="font-medium">{selectedItem.source}</div>
                              <div className="text-sm text-white/50">
                                {selectedItem.linkCode ? `提取码：${selectedItem.linkCode}` : '无需提取码'}
                              </div>
                            </div>
                          </div>
                          <span className="px-3 py-1 bg-violet-600 rounded-lg text-sm opacity-0 group-hover:opacity-100 transition shrink-0">
                            ⬇ 下载
                          </span>
                        </button>
                      )}
                    </div>

                    {/* Related Links (same TMDB ID) */}
                    {relatedItems.length > 0 && tmdbType === 'tv' ? (
                      <div className="space-y-2">
                        {(() => {
                          const current = relatedItems.filter(r => r.isCurrent !== false);
                          return (
                            <>
                              <div className="text-xs text-white/40 mb-1">📌 当前版本（共 {current.length} 个）</div>
                              {current.map((rel) => (
                                <div key={rel.id}>
                                  {isMagnetOrEd2k(rel.link) ? (
                                    <button
                                      onClick={(e) => { e.preventDefault(); handleCopyLink(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-violet-600/10 hover:bg-violet-600/20 rounded-lg transition text-left"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="px-2 py-0.5 bg-violet-600/30 rounded text-xs shrink-0">{rel.source}</span>
                                        <span className="text-sm truncate">{rel.name}</span>
                                      </div>
                                      <span className="text-cyan-400 text-xs shrink-0 ml-2">📋 复制</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.preventDefault(); handleDownload(rel.id, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-violet-600/10 hover:bg-violet-600/20 rounded-lg transition text-left"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="px-2 py-0.5 bg-violet-600/30 rounded text-xs shrink-0">{rel.source}</span>
                                        <span className="text-sm truncate">{rel.name}</span>
                                      </div>
                                      <span className="text-white/40 text-xs shrink-0 ml-2">{rel.size || ''}</span>
                                    </button>
                                  )}
                                </div>
                              ))}
                            </>
                          );
                        })()}
                        {(() => {
                          const history = relatedItems.filter(r => r.isCurrent === false);
                          if (history.length === 0) return null;
                          return (
                            <>
                              <button
                                onClick={() => setHistoryExpanded(!historyExpanded)}
                                className="w-full flex items-center justify-between p-2 text-xs text-white/40 hover:text-white/60 transition"
                              >
                                <span>📦 历史版本（共 {history.length} 个）</span>
                                <span>{historyExpanded ? '▲ 收起' : '▼ 展开'}</span>
                              </button>
                              {historyExpanded && history.map((rel) => (
                                <div key={rel.id} className="opacity-60">
                                  {isMagnetOrEd2k(rel.link) ? (
                                    <button
                                      onClick={(e) => { e.preventDefault(); handleCopyLink(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="px-2 py-0.5 bg-white/20 rounded text-xs shrink-0">{rel.source}</span>
                                        <span className="text-sm truncate line-through">{rel.name}</span>
                                      </div>
                                      <span className="text-white/40 text-xs shrink-0 ml-2">📋 复制</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.preventDefault(); handleDownload(rel.id, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="px-2 py-0.5 bg-white/20 rounded text-xs shrink-0">{rel.source}</span>
                                        <span className="text-sm truncate line-through">{rel.name}</span>
                                      </div>
                                      <span className="text-white/40 text-xs shrink-0 ml-2">{rel.size || ''}</span>
                                    </button>
                                  )}
                                </div>
                              ))}
                            </>
                          );
                        })()}
                      </div>
                    ) : relatedItems.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-xs text-white/40 mb-1">📦 其他版本（共 {relatedItems.length} 个）</div>
                        {relatedItems.map((rel) => (
                          isMagnetOrEd2k(rel.link) ? (
                            <button
                              key={rel.id}
                              onClick={(e) => { e.preventDefault(); handleCopyLink(rel.link, e); }}
                              className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="px-2 py-0.5 bg-cyan-600/30 rounded text-xs shrink-0">{rel.source}</span>
                                <span className="text-sm truncate">{rel.name}</span>
                              </div>
                              <span className="text-cyan-400 text-xs shrink-0 ml-2">📋 复制</span>
                            </button>
                          ) : (
                            <button
                              key={rel.id}
                              onClick={(e) => { e.preventDefault(); handleDownload(rel.id, e); }}
                              className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="px-2 py-0.5 bg-pink-600/30 rounded text-xs shrink-0">{rel.source}</span>
                                <span className="text-sm truncate">{rel.name}</span>
                              </div>
                              <span className="text-white/40 text-xs shrink-0 ml-2">{rel.size || ''}</span>
                            </button>
                          )
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* Tags */}
                  {selectedItem.tags?.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm text-white/60 mb-2">标签：</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedItem.tags.map((tag) => (
                          <span key={tag} className="px-3 py-1 bg-white/10 rounded-full text-sm">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Download Toasts */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {downloadToasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 80, scale: 0.8 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.8 }}
              className={`px-5 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 min-w-[220px] ${
                toast.type === 'success' ? 'bg-green-600/90 text-white' :
                toast.type === 'cooldown' ? 'bg-orange-600/90 text-white' :
                toast.type === 'limit' ? 'bg-blue-600/90 text-white' :
                toast.type === 'banned' ? 'bg-red-700/90 text-white' :
                'bg-red-600/90 text-white'
              }`}
            >
              <span className="text-base">
                {toast.type === 'success' ? '✓' :
                 toast.type === 'cooldown' ? '⏳' :
                 toast.type === 'limit' ? '📊' :
                 toast.type === 'banned' ? '🚫' : '✕'}
              </span>
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Copy Toasts */}
      <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {copyToasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: -80, scale: 0.8 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -80, scale: 0.8 }}
              className="px-5 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 min-w-[180px] bg-cyan-600/90 text-white"
            >
              📋 {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}