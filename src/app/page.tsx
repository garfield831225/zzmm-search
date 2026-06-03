'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Music, Library, LogOut, CreditCard } from 'lucide-react';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMAGE_FALLBACK = 'https://image.tmdb.org/t/p/w500/7bUqJAuI5LFiJ6xMcLQ2E3YL8w1a.jpg';

const CATEGORIES = ['全部', '连载', '电影', '剧集', '动漫', '少儿频道', '综艺', '演唱会', '纪录片', '原盘', 'REMUX', '系列电影'];
const SOURCES = ['全部', '115网盘', '百度网盘', '阿里云盘', '夸克网盘', '磁力链接', 'ed2k链接'];
const REGIONS = ['全部', '大陆', '欧美', '日韩', '港澳台'];
const YEARS = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020', '2010-2019', '2000-2009'];

interface DownloadToast {
  id: number;
  type: 'success' | 'cooldown' | 'limit' | 'banned' | 'error';
  message: string;
}

interface TmdbInfo {
  title: string;
  title_zh: string;
  poster_path: string;
  vote_average: string;
  vote_count: number;
  overview: string;
  release_date: string;
  tagline: string;
  original_title: string;
  genres: string[];
}

interface CreditPerson {
  name: string;
  character: string;
  profile_path: string;
  known_for_department: string;
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
  credits?: { director: CreditPerson[]; cast: CreditPerson[] };
  // 2026-06-03 单资源付费
  payType?: 'free' | 'code';
  codePrice?: number;
  unlocked?: boolean;
}

interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  items: ResourceItem[];
  categories: string[];
  sources: string[];
}

function StarRating({ score }: { score: number }) {
  const stars = Math.round((score / 10) * 5);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`text-xs ${i <= stars ? 'text-yellow-400' : 'text-white/20'}`}>★</span>
      ))}
      <span className="text-xs text-white/60 ml-1">{score.toFixed(1)}</span>
    </div>
  );
}

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [source, setSource] = useState('全部');
  const [region, setRegion] = useState('全部');
  const [year, setYear] = useState('全部');
  const [sort, setSort] = useState('release_date');
  const [pageSize, setPageSize] = useState(30);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ResourceItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [relatedItems, setRelatedItems] = useState<ResourceItem[]>([]);
  const [tmdbType, setTmdbType] = useState<string>('movie');
  const [tmdbCredits, setTmdbCredits] = useState<{ director: any[]; cast: any[]; overview: string; tagline: string; original_title: string; vote_count: number; genres: string[] } | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [user, setUser] = useState<{ id: number; username: string; group: string; expire_at: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [downloadToasts, setDownloadToasts] = useState<DownloadToast[]>([]);
  const [copyToasts, setCopyToasts] = useState<DownloadToast[]>([]);
  // 2026-06-03 单资源付费 unlock modal
  const [unlockItem, setUnlockItem] = useState<ResourceItem | null>(null);
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  let toastCounter = 0;
  let copyToastCounter = 0;

  const addToast = useCallback((type: DownloadToast['type'], message: string) => {
    const id = ++toastCounter;
    setDownloadToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setDownloadToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const handleDirectOpen = useCallback((link: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (link) window.open(link, '_blank');
    else addToast('error', '链接无效');
  }, [addToast]);

  const extractCodeFromUrl = (link: string): string | null => {
    if (!link) return null;
    const match = link.match(/[?&]password=([^&]+)/i);
    return match ? match[1] : null;
  };

  const handleDownload = useCallback(async (resourceId: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const token = localStorage.getItem('token');
    if (!token) { addToast('error', '请先登录'); return; }
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
    } catch { addToast('error', '网络错误，请重试'); }
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
    try { await navigator.clipboard.writeText(link); addCopyToast('已复制到剪贴板'); }
    catch { addCopyToast('复制失败，请手动复制'); }
  }, [addCopyToast]);

  useEffect(() => { setMounted(true); const stored = localStorage.getItem('user'); if (stored) { try { setUser(JSON.parse(stored)); } catch {} } }, []);

  // 用 ref 记录最新 state，在 effect 调用 fetchItems 之前同步最新值
  const latestRef = useRef({ query, category, source, region, year, sort, pageSize });
  latestRef.current = { query, category, source, region, year, sort, pageSize };

  // 空 deps —— 永远同一函数引用，永远用 latestRef 读最新 state
  const fetchItems = useCallback(async (p?: number) => {
    const targetPage = p !== undefined ? p : 1;
    setPage(targetPage);
    setLoading(true);
    const { query: q, category: cat, source: src, region: reg, year: yr, sort: s, pageSize: ps } = latestRef.current;
    try {
      const params = new URLSearchParams({ page: targetPage.toString(), pageSize: ps.toString() });
      if (q) params.set('q', q);
      if (cat !== '全部') params.set('category', cat);
      if (src !== '全部') params.set('source', src);
      if (reg !== '全部') params.set('region', reg);
      if (yr !== '全部') params.set('year', yr);
      params.set('sort', s);
      const res = await fetch(`/api/search?${params}`);
      const data: SearchResponse = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) { console.error('Fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  // 先同步 ref 再调用，永远读最新 state
  useEffect(() => {
    latestRef.current = { query, category, source, region, year, sort, pageSize };
    fetchItems(1);
  }, [category, source, region, year, sort, pageSize]); // eslint-line -- stable deps


  useEffect(() => { fetchItems(1); }, [category, source, region, year, sort, pageSize]);

  const handleLogout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); };

  // 2026-06-03 单资源付费 - 解锁处理
  const handleUnlock = async () => {
    if (!unlockItem || !unlockCode.trim()) {
      setUnlockError('请输入激活码');
      return;
    }
    if (!user) {
      setUnlockError('请先登录');
      return;
    }
    setUnlockLoading(true);
    setUnlockError('');
    try {
      const token = localStorage.getItem('token') || '';
      const r = await fetch('/api/resources/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: unlockCode.trim(), resource_id: unlockItem.id }),
      });
      const data = await r.json();
      if (data.success) {
        // 更新本地状态
        setItems(prev => prev.map(i => i.id === unlockItem.id ? { ...i, unlocked: true } : i));
        if (selectedItem?.id === unlockItem.id) {
          setSelectedItem(prev => prev ? { ...prev, unlocked: true } : prev);
        }
        setUnlockItem(null);
        setUnlockCode('');
        addToast('success', `🎉 解锁成功: ${data.resource.name}`);
      } else {
        setUnlockError(data.error || '解锁失败');
      }
    } catch (e: any) {
      setUnlockError('网络错误: ' + e.message);
    }
    setUnlockLoading(false);
  };

  const openUnlock = (item: ResourceItem) => {
    if (!user) {
      addToast('error', '请先登录');
      return;
    }
    setUnlockItem(item);
    setUnlockCode('');
    setUnlockError('');
  };

  const handleItemClick = async (item: ResourceItem) => {
    setSelectedItem(item);
    setHistoryExpanded(false);
    setTmdbCredits(null);
    if (item.tmdbId) {
      setDetailLoading(true);
      try {
        const [relRes, credRes] = await Promise.all([
          fetch(`/api/resource/${item.id}/related`),
          fetch(`/api/admin/tmdb-credits?tmdbId=${item.tmdbId}&type=${item.category === '连载' || item.category === '剧集' || item.category === '动漫' || item.category === '综艺' ? 'tv' : 'movie'}`),
        ]);
        const relData = await relRes.json();
        const credData = await credRes.json();
        setRelatedItems(relData.items || []);
        setTmdbType(relData.tmdbType || 'movie');
        if (credData.director || credData.cast) {
          setTmdbCredits(credData);
        }
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
                  <span className="px-3 py-1.5 bg-violet-600/30 rounded-lg text-sm text-violet-300">{user.username}</span>
                  <Link href="/nonfilm" className="group flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/50 rounded-lg text-sm transition-all duration-200 text-cyan-300 hover:shadow-[0_0_12px_rgba(34,211,238,0.4)] hover:scale-105">
                    <Music size={14} className="transition-transform group-hover:scale-110" />
                    <span>非影视区</span>
                  </Link>
                  <Link href="/library" className="group flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/50 rounded-lg text-sm transition-all duration-200 text-violet-300 hover:shadow-[0_0_12px_rgba(167,139,250,0.4)] hover:scale-105">
                    <Library size={14} className="transition-transform group-hover:scale-110" />
                    <span>文档资源库</span>
                  </Link>
                  <button onClick={handleLogout} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition">退出</button>
                  <Link href="/activate" className="px-3 py-1.5 bg-pink-600/50 hover:bg-pink-600 rounded-lg text-sm transition">续费</Link>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link href="/nonfilm" className="group flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/50 rounded-lg text-sm transition-all duration-200 text-cyan-300 hover:shadow-[0_0_12px_rgba(34,211,238,0.4)] hover:scale-105">
                    <Music size={14} className="transition-transform group-hover:scale-110" />
                    <span>非影视区</span>
                  </Link>
                  <Link href="/library" className="group flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/50 rounded-lg text-sm transition-all duration-200 text-violet-300 hover:shadow-[0_0_12px_rgba(167,139,250,0.4)] hover:scale-105">
                    <Library size={14} className="transition-transform group-hover:scale-110" />
                    <span>文档资源库</span>
                  </Link>
                  <Link href="/login" className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition">登录 / 注册</Link>
                </div>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative flex gap-2">
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchItems(1); }}
              placeholder="输入片名、类型、分类搜索..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-5 py-3 pl-12 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition" />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none">🔍</span>
            <button onClick={() => fetchItems(1)} className="px-5 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl text-white font-medium transition shrink-0">搜索</button>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col gap-2 mt-4">
            {/* 分类 */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition shrink-0 ${category === cat ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{cat}</button>
              ))}
            </div>
            {/* 来源 */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {SOURCES.map((src) => (
                <button key={src} onClick={() => setSource(src)}
                  className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition shrink-0 ${source === src ? 'bg-pink-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{src}</button>
              ))}
            </div>
            {/* 地区 */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <span className="text-xs text-white/30 self-center mr-1 shrink-0">地区</span>
              {REGIONS.map((r) => (
                <button key={r} onClick={() => setRegion(r)}
                  className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition shrink-0 ${region === r ? 'bg-orange-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{r}</button>
              ))}
            </div>
            {/* 年份 */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <span className="text-xs text-white/30 self-center mr-1 shrink-0">年份</span>
              {YEARS.map((y) => (
                <button key={y} onClick={() => setYear(y)}
                  className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition shrink-0 ${year === y ? 'bg-cyan-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{y}</button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Sort & Size Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">排序</span>
            <div className="flex gap-1">
              <button onClick={() => setSort('release_date')}
                className={`px-3 py-1 rounded-full text-xs transition ${sort === 'release_date' ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>🎬 上映</button>
              <button onClick={() => setSort('added_time')}
                className={`px-3 py-1 rounded-full text-xs transition ${sort === 'added_time' ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>📅 上架</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 hidden sm:inline">每页</span>
            <div className="flex gap-1">
              {[30, 90, 150].map((s) => (
                  <button key={s} onClick={() => { latestRef.current = { ...latestRef.current, pageSize: s }; setPageSize(s); }}
                  className={`px-3 py-1 rounded-full text-xs transition ${pageSize === s ? 'bg-pink-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{s}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
          {(() => {
            // 2026-06-03: 连载/剧集/动漫/综艺 按 category + tmdb_id 折叠
            // 显示最新一条 + "+N 集"徽章
            const groupableCats = ['连载', '剧集', '动漫', '综艺'];
            const seen = new Set<string>();
            const displayItems: Array<ResourceItem & { _extraCount?: number; _allIds?: number[] }> = [];
            for (const item of items) {
              if (item.tmdbId && groupableCats.includes(item.category)) {
                const key = `${item.category}:${item.tmdbId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                // 同 tmdb 同 category 的其他资源
                const group = items.filter(i =>
                  i.tmdbId === item.tmdbId && i.category === item.category
                );
                const extraCount = group.length - 1;
                const allIds = group.map(i => i.id);
                displayItems.push({ ...item, _extraCount: extraCount, _allIds: allIds });
              } else {
                displayItems.push(item);
              }
            }
            return displayItems;
          })().map((item) => {
            const extraCount = (item as any)._extraCount || 0;
            const allIds = (item as any)._allIds || [item.id];
            return (
            <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="group cursor-pointer" onClick={() => handleItemClick(item)}
            >
              {/* Poster */}
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-3">
                {item.tmdb?.poster_path ? (
                  <img src={`${TMDB_IMAGE_BASE}${item.tmdb.poster_path}`} alt={item.name}
                    className="w-full h-full object-cover transition group-hover:scale-105"
                    onError={(e) => { (e.target as HTMLImageElement).src = TMDB_IMAGE_FALLBACK; }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-violet-900/30 to-pink-900/30">🎬</div>
                )}

                {/* Bottom Info Bar */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pt-6 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/80">{item.tmdb?.release_date?.slice(0, 4) || ''}</span>
                    {item.tmdb?.vote_average && (
                      <StarRating score={parseFloat(item.tmdb.vote_average)} />
                    )}
                  </div>
                </div>

                {/* Tags */}
                <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                  {item.tags?.slice(0, 2).map((tag) => (
                    <span key={tag} className="px-2 py-0.5 bg-violet-600/80 text-xs rounded">{tag}</span>
                  ))}
                  {/* 2026-06-03: 同 TMDB 多集徽章 */}
                  {extraCount > 0 && (
                    <span className="px-2 py-0.5 bg-amber-500/90 text-black text-xs rounded font-medium">
                      +{extraCount} 集
                    </span>
                  )}
                </div>

                {/* Source Badge */}
                <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                  <span className="px-2 py-0.5 bg-pink-600/80 text-xs rounded">{item.source}</span>
                  {/* 2026-06-03 单资源付费标记 */}
                  {item.payType === 'code' && !item.unlocked && (
                    <span className="px-2 py-0.5 bg-yellow-500/90 text-black text-xs rounded font-medium">
                      ¥{item.codePrice || 0} 解锁
                    </span>
                  )}
                  {item.payType === 'code' && item.unlocked && (
                    <span className="px-2 py-0.5 bg-green-500/90 text-white text-xs rounded font-medium">
                      ✓ 已解锁
                    </span>
                  )}
                </div>

                {/* Overlay + Action */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                  {isMagnetOrEd2k(item.link) ? (
                    <button onClick={(e) => { e.stopPropagation(); handleCopyLink(item.link, e); }}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium">📋 复制链接</button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); handleDirectOpen(item.link, e); }}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium">🔗 打开</button>
                  )}
                </div>
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
            );
          })}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex flex-col items-center gap-3 mt-8">
            {/* Page info */}
            <div className="text-xs text-white/40">
              共 {total.toLocaleString()} 条，第 {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} 页
            </div>
            {/* Page nav */}
            <div className="flex items-center gap-1 flex-wrap justify-center">
              <button onClick={() => fetchItems(1)} disabled={page === 1 || loading}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition">« 首页</button>
              <button onClick={() => fetchItems(page - 1)} disabled={page === 1 || loading}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition">‹ 上一页</button>

              {/* Page numbers */}
              {(() => {
                const totalPages = Math.ceil(total / pageSize);
                const pages: (number | string)[] = [];
                if (totalPages <= 7) {
                  for (let i = 1; i <= totalPages; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (page > 3) pages.push('...');
                  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
                  if (page < totalPages - 2) pages.push('...');
                  pages.push(totalPages);
                }
                return pages.map((p, idx) =>
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="px-1 text-white/30 text-xs">···</span>
                  ) : (
                    <button key={p} onClick={() => fetchItems(p as number)}
                      className={`w-9 h-9 rounded-lg text-xs font-medium transition ${page === p ? 'bg-violet-600 text-white' : 'bg-white/5 hover:bg-white/10 text-white/60'}`}>{p}</button>
                  )
                );
              })()}

              <button onClick={() => fetchItems(page + 1)} disabled={page >= Math.ceil(total / pageSize) || loading}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition">下一页 ›</button>
              <button onClick={() => fetchItems(Math.ceil(total / pageSize))} disabled={page >= Math.ceil(total / pageSize) || loading}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition">末页 »</button>
            </div>

            {/* Mobile page select */}
            <div className="sm:hidden flex items-center gap-2">
              <span className="text-xs text-white/40">跳至</span>
              <select value={page} onChange={(e) => fetchItems(parseInt(e.target.value))}
                className="bg-white/10 border border-white/10 text-white text-xs rounded-lg px-2 py-1.5">
                {Array.from({ length: Math.ceil(total / pageSize) }, (_, i) => i + 1).map((p) => (
                  <option key={p} value={p}>第 {p} 页</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </main>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setSelectedItem(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#12121a] rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-col md:flex-row">
                <div className="w-full md:w-80 shrink-0">
                  <div className="aspect-[2/3] bg-white/5">
                    {selectedItem.tmdb?.poster_path ? (
                      <img src={`${TMDB_IMAGE_BASE}${selectedItem.tmdb.poster_path}`} alt={selectedItem.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-6xl">🎬</div>
                    )}
                  </div>
                </div>
                <div className="flex-1 p-6 overflow-y-auto max-h-[70vh]">
                  {/* Title + Close */}
                  <div className="flex items-start justify-between mb-5">
                    <h2 className="text-xl font-bold leading-tight pr-4">{selectedItem.name}</h2>
                    <button onClick={() => setSelectedItem(null)} className="p-1.5 hover:bg-white/10 rounded-lg transition shrink-0 text-white/40 hover:text-white">✕</button>
                  </div>
                  {/* ── TMDB Info Section ── */}
                  {selectedItem.tmdb && (
                    <div className="mb-5 space-y-4">
                      {/* Tagline */}
                      {tmdbCredits?.tagline && (
                        <p className="text-sm italic text-amber-400/80">"{tmdbCredits.tagline}"</p>
                      )}

                      {/* Rating row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        {selectedItem.tmdb.vote_average && (
                          <>
                            <div className="flex items-center gap-1">
                              <span className="text-2xl font-bold text-yellow-400">{parseFloat(selectedItem.tmdb.vote_average).toFixed(1)}</span>
                              <span className="text-white/30 text-sm">/ 10</span>
                            </div>
                            <StarRating score={parseFloat(selectedItem.tmdb.vote_average)} />
                            {(tmdbCredits?.vote_count ?? 0) > 0 && (
                              <span className="text-xs text-white/30">{(tmdbCredits?.vote_count ?? 0).toLocaleString()} 人评分</span>
                            )}
                          </>
                        )}
                        {selectedItem.tmdb.release_date && (
                          <span className="text-sm text-white/50">📅 {selectedItem.tmdb.release_date}</span>
                        )}
                        {tmdbCredits?.original_title && tmdbCredits.original_title !== selectedItem.name && (
                          <span className="text-sm text-white/30 italic">{tmdbCredits.original_title}</span>
                        )}
                      </div>

                      {/* Genres */}
{(tmdbCredits && (tmdbCredits.genres?.length ?? 0) > 0) && (
                          <div className="flex flex-wrap gap-1.5">
                            {tmdbCredits.genres.map((g) => (
                            <span key={g} className="px-2.5 py-1 bg-violet-600/30 text-violet-300 text-xs rounded-full border border-violet-500/20">{g}</span>
                          ))}
                        </div>
                      )}

                      {/* Director */}
                      {tmdbCredits && tmdbCredits.director?.length > 0 && (
                        <div>
                          <div className="text-xs text-white/40 mb-2">🎬 导演</div>
                          <div className="flex gap-3 overflow-x-auto scrollbar-hide">
                            {tmdbCredits.director.map((d, i) => (
                              <div key={i} className="flex flex-col items-center shrink-0 w-16">
                                <div className="w-12 h-12 rounded-full bg-white/10 overflow-hidden mb-1 flex items-center justify-center text-lg">
                                  {d.profile_path ? <img src={d.profile_path} alt={d.name} className="w-full h-full object-cover" /> : '🎬'}
                                </div>
                                <span className="text-xs text-white/70 text-center leading-tight truncate w-full">{d.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Cast */}
                      {tmdbCredits && tmdbCredits.cast?.length > 0 && (
                        <div>
                          <div className="text-xs text-white/40 mb-2">🎭 演员</div>
                          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                            {tmdbCredits.cast.slice(0, 15).map((c, i) => (
                              <div key={i} className="flex flex-col items-center shrink-0 w-16">
                                <div className="w-12 h-12 rounded-full bg-white/10 overflow-hidden mb-1 flex items-center justify-center text-lg">
                                  {c.profile_path ? <img src={c.profile_path} alt={c.name} className="w-full h-full object-cover" /> : '👤'}
                                </div>
                                <span className="text-xs text-white/70 text-center leading-tight truncate w-full">{c.name}</span>
                                {c.character && <span className="text-xs text-white/30 text-center truncate w-full">{c.character}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Synopsis */}
                      {tmdbCredits?.overview && (
                        <div>
                          <div className="text-xs text-white/40 mb-1.5">📖 简介</div>
                          <p className="text-sm text-white/60 leading-relaxed">{tmdbCredits.overview}</p>
                        </div>
                      )}

                      {/* Basic info row */}
                      <div className="flex flex-wrap gap-2 text-sm">
                        <span className="px-2 py-1 bg-violet-600/30 rounded text-violet-300">{selectedItem.category}</span>
                        <span className="px-2 py-1 bg-pink-600/30 rounded text-pink-300">{selectedItem.source}</span>
                        {selectedItem.type && <span className="px-2 py-1 bg-white/10 rounded text-white/60">{selectedItem.type}</span>}
                        {selectedItem.size && <span className="px-2 py-1 bg-white/10 rounded text-white/50">📦 {selectedItem.size}</span>}
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <h3 className="font-semibold text-base text-white/80">📎 资源链接</h3>
                    <div className="space-y-2">
                      <div className="text-xs text-white/40 mb-1">📌 当前版本</div>
                      {isMagnetOrEd2k(selectedItem.link) ? (
                        <button onClick={(e) => { e.preventDefault(); handleCopyLink(selectedItem.link, e); }}
                          className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 rounded-xl transition group text-left">
                          <div className="flex items-center gap-3"><span className="text-xl">🔗</span>
                            <div><div className="font-medium">{selectedItem.source}</div><div className="text-sm text-cyan-400">磁力/ED2K链接，点击复制</div></div>
                          </div>
                          <span className="px-3 py-1 bg-cyan-600 rounded-lg text-sm opacity-0 group-hover:opacity-100 transition shrink-0">📋 复制</span>
                        </button>
                      ) : (
                        <button onClick={(e) => { e.preventDefault(); handleDirectOpen(selectedItem.link, e); }}
                          className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 rounded-xl transition group text-left">
                          <div className="flex items-center gap-3"><span className="text-xl">🔗</span>
                            <div><div className="font-medium">{selectedItem.source}</div>
                              <div className="text-sm text-white/50">{extractCodeFromUrl(selectedItem.link) ? `提取码：${extractCodeFromUrl(selectedItem.link)}` : '无需提取码'}</div>
                            </div>
                          </div>
                          <span className="px-3 py-1 bg-violet-600 rounded-lg text-sm opacity-0 group-hover:opacity-100 transition shrink-0">🔗 打开</span>
                        </button>
                      )}

                      {/* 2026-06-03 单资源付费 - 解锁按钮 */}
                      {selectedItem.payType === 'code' && !selectedItem.unlocked && (
                        <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-yellow-300">🔒 此资源需要激活码</div>
                              <div className="text-xs text-white/60 mt-1">起步价 ¥{selectedItem.codePrice || 0} · 8 位激活码</div>
                            </div>
                            <button onClick={() => openUnlock(selectedItem)}
                              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm font-medium shrink-0">
                              输入激活码
                            </button>
                          </div>
                          <div className="text-xs text-white/40 mt-2">购买联系：HK 麦盘人微信 / 支付宝扫码</div>
                        </div>
                      )}
                      {selectedItem.payType === 'code' && selectedItem.unlocked && (
                        <div className="mt-3 p-2 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-300 flex items-center gap-2">
                          ✓ 您已解锁此资源
                        </div>
                      )}
                    </div>

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
                                    <button onClick={(e) => { e.preventDefault(); handleCopyLink(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-violet-600/10 hover:bg-violet-600/20 rounded-lg transition text-left">
                                      <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-violet-600/30 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate">{rel.name}</span></div>
                                      <span className="text-cyan-400 text-xs shrink-0 ml-2">📋 复制</span>
                                    </button>
                                  ) : (
                                    <button onClick={(e) => { e.preventDefault(); handleDirectOpen(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-violet-600/10 hover:bg-violet-600/20 rounded-lg transition text-left">
                                      <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-violet-600/30 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate">{rel.name}</span></div>
                                      <span className="text-violet-400 text-xs shrink-0 ml-2">🔗 打开</span>
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
                              <button onClick={() => setHistoryExpanded(!historyExpanded)} className="w-full flex items-center justify-between p-2 text-xs text-white/40 hover:text-white/60 transition">
                                <span>📦 历史版本（共 {history.length} 个）</span><span>{historyExpanded ? '▲ 收起' : '▼ 展开'}</span>
                              </button>
                              {historyExpanded && history.map((rel) => (
                                <div key={rel.id} className="opacity-60">
                                  {isMagnetOrEd2k(rel.link) ? (
                                    <button onClick={(e) => { e.preventDefault(); handleCopyLink(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left">
                                      <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-white/20 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate line-through">{rel.name}</span></div>
                                      <span className="text-white/40 text-xs shrink-0 ml-2">📋 复制</span>
                                    </button>
                                  ) : (
                                    <button onClick={(e) => { e.preventDefault(); handleDirectOpen(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left">
                                      <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-white/20 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate line-through">{rel.name}</span></div>
                                      <span className="text-white/60 text-xs shrink-0 ml-2">🔗 打开</span>
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
                            <button key={rel.id} onClick={(e) => { e.preventDefault(); handleCopyLink(rel.link, e); }}
                              className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left">
                              <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-cyan-600/30 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate">{rel.name}</span></div>
                              <span className="text-cyan-400 text-xs shrink-0 ml-2">📋 复制</span>
                            </button>
                          ) : (
                            <button key={rel.id} onClick={(e) => { e.preventDefault(); handleDirectOpen(rel.link, e); }}
                              className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left">
                              <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-pink-600/30 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate">{rel.name}</span></div>
                              <span className="text-pink-400 text-xs shrink-0 ml-2">🔗 打开</span>
                            </button>
                          )
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {selectedItem.tags?.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm text-white/60 mb-2">标签：</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedItem.tags.map((tag) => (<span key={tag} className="px-3 py-1 bg-white/10 rounded-full text-sm">{tag}</span>))}
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
            <motion.div key={toast.id} initial={{ opacity: 0, x: 80, scale: 0.8 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 80, scale: 0.8 }}
              className={`px-5 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 min-w-[220px] ${toast.type === 'success' ? 'bg-green-600/90 text-white' : toast.type === 'cooldown' ? 'bg-orange-600/90 text-white' : toast.type === 'limit' ? 'bg-blue-600/90 text-white' : toast.type === 'banned' ? 'bg-red-700/90 text-white' : 'bg-red-600/90 text-white'}`}>
              <span>{toast.type === 'success' ? '✓' : toast.type === 'cooldown' ? '⏳' : toast.type === 'limit' ? '📊' : toast.type === 'banned' ? '🚫' : '✕'}</span>
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Copy Toasts */}
      <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {copyToasts.map((toast) => (
            <motion.div key={toast.id} initial={{ opacity: 0, x: -80, scale: 0.8 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -80, scale: 0.8 }}
              className="px-5 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 min-w-[180px] bg-cyan-600/90 text-white">
              📋 {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 2026-06-03 单资源付费 unlock 弹窗 */}
      {unlockItem && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[60]"
          onClick={() => !unlockLoading && setUnlockItem(null)}>
          <div className="bg-[#12121a] rounded-2xl p-6 w-full max-w-md border border-yellow-500/30"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🔒</span>
              <h3 className="text-lg font-semibold">解锁资源</h3>
              <button onClick={() => !unlockLoading && setUnlockItem(null)}
                className="ml-auto p-1 hover:bg-white/10 rounded text-white/40 hover:text-white">✕</button>
            </div>
            <div className="mb-4">
              <div className="text-sm text-white/80 font-medium truncate">{unlockItem.name}</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 rounded text-xs">付费资源</span>
                <span className="text-yellow-300 font-bold">¥{unlockItem.codePrice || 0}</span>
                <span className="text-xs text-white/40">{unlockItem.category} · #{unlockItem.id}</span>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-white/60 mb-1.5">激活码（8 位大小写字母数字）</label>
                <input
                  value={unlockCode}
                  onChange={e => setUnlockCode(e.target.value.toUpperCase().slice(0, 8))}
                  onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                  placeholder="如 A3B7X9K2"
                  maxLength={8}
                  className="w-full bg-black/40 border border-white/20 rounded-lg px-4 py-3 text-white font-mono text-lg tracking-widest uppercase placeholder-white/20"
                  autoFocus
                  disabled={unlockLoading}
                />
              </div>
              {unlockError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  ✕ {unlockError}
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setUnlockItem(null)} disabled={unlockLoading}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm disabled:opacity-30">取消</button>
              <button onClick={handleUnlock} disabled={unlockLoading || unlockCode.length !== 8}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm font-medium disabled:opacity-30">
                {unlockLoading ? '解锁中...' : '🔓 解锁'}
              </button>
            </div>
            <div className="mt-4 text-xs text-white/40 text-center">
              购买激活码联系：HK 麦盘人微信 / 支付宝扫码
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
