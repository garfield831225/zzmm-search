'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// 2026-07-15 非影视区子页公共组件: pageMode + cover_first + 列表布局
// 复用: sports/ebooks/courses/textbooks 4 个子页
// 风格: 亮色清爽 (区别于影视区暗色) + 列表布局无海报

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
  sportsCover: { team_name: string; team_alternate: string; stadium: string; league: string; badge_url: string; banner_url: string; description: string } | null;
  coverCache: { cover_url: string; source: string; extra_data: any } | null;
  payType: string;
  codePrice: number;
  lumenCost: number;
  unlocked: boolean;
}

interface NonFilmListProps {
  category: string;            // 资源 category (e.g. '体育', '电子书')
  title: string;               // 子页标题 (e.g. '体育资源')
  icon: string;                // emoji
  description: string;         // 副标题
  accentColor: string;         // tailwind gradient class
  // 未来扩展: hidePay, defaultSort, etc.
}

const SOURCES = ['全部', '115网盘', '百度网盘', '阿里云盘', '磁力链接', 'ed2k链接'];
const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k',
};
const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'aliyun': '阿里云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接',
};

const FORMAT_PATTERNS = [
  'FLAC', 'ALAC', 'WAV', 'APE', 'AIFF', 'DSD', 'DSF', 'DFF',
  '24bit', '32bit', '16bit', '48kHz', '96kHz', '192kHz', '44.1kHz',
  'Hi-Res', 'HR', 'SACD', 'DVD', 'BD', 'ISO', 'MKV', 'MP4',
  'AAC', 'OGG', 'WMA', 'M4A', 'TAK', 'SPMONLY',
  'LIVE', 'LIVE版', '演唱会', '录音室', 'Studio',
];

function extractFormatTags(name: string): string[] {
  const found: string[] = [];
  const upper = name.toUpperCase();
  for (const p of FORMAT_PATTERNS) {
    if (upper.includes(p.toUpperCase())) found.push(p);
  }
  return Array.from(new Set(found)).slice(0, 6);
}

export default function NonFilmList({ category, title, icon, description, accentColor }: NonFilmListProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('全部');
  const [sort, setSort] = useState('cover_first');  // 默认 cover_first
  const [pageMode, setPageMode] = useState<'load' | 'paging'>('load');  // 默认加载更多
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ResourceItem | null>(null);
  const [toasts, setToasts] = useState<{ id: number; type: string; message: string }[]>([]);
  const [unlockItem, setUnlockItem] = useState<ResourceItem | null>(null);
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [lumenBalance, setLumenBalance] = useState(0);
  const toastCounter = useRef(0);

  const addToast = useCallback((type: string, message: string) => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  const isMagnetOrEd2k = (link: string) => link?.startsWith('magnet:') || link?.startsWith('ed2k://');

  const handleCopyLink = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      addToast('success', '已复制到剪贴板');
    } catch {
      addToast('error', '复制失败，请手动复制');
    }
  }, [addToast]);

  const handleDownload = useCallback(async (resourceId: number, link: string) => {
    if (!isMagnetOrEd2k(link)) { window.open(link, '_blank'); return; }
    try {
      const res = await fetch(`/api/download?id=${resourceId}`);
      const data = await res.json();
      if (data.success && data.url) {
        addToast('success', '下载链接已就绪');
        setTimeout(() => window.open(data.url, '_blank'), 600);
      } else addToast('error', data.message || '下载失败');
    } catch { addToast('error', '网络错误'); }
  }, [addToast]);

  // 2026-07-15: pageMode 切换 + 避免闭包旧值
  // append: true → 接在 items 后面; false → 替换
  const fetchItems = useCallback(async (p = 1, append = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: p.toString(), pageSize: '30', category, zone: 'nonfilm', sort,
      });
      if (query) params.set('q', query);
      if (source !== '全部') params.set('source', SOURCE_KEY_MAP[source] || source);
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      const mapped: ResourceItem[] = (data.items || []).map((it: any) => ({
        ...it,
        formatTags: extractFormatTags(it.name),
      }));
      setItems(prev => append ? [...prev, ...mapped] : mapped);
      setTotal(data.total || 0);
      setPage(p);
    } catch { addToast('error', '搜索失败'); }
    finally { setLoading(false); }
  }, [query, source, category, sort, addToast]);

  // category/source/sort 变化 → 重置到 page 1 替换
  useEffect(() => { fetchItems(1, false); }, [category, source, sort]);

  // pageMode 切换 → 重置
  useEffect(() => { setItems([]); setPage(1); }, [pageMode]);

  // 加载流明余额
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('/api/user/lumen', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.balance !== undefined) setLumenBalance(d.balance); })
      .catch(() => {});
  }, []);

  // 加载更多 (mode='load')
  const handleLoadMore = () => fetchItems(page + 1, true);

  // 真分页 (mode='paging')
  const handlePageChange = (p: number) => {
    if (p < 1 || p > Math.ceil(total / 30) || loading) return;
    setItems([]); // 清空再加载 (避免闭包旧值)
    fetchItems(p, false);
  };

  // 解锁单资源
  const openUnlock = (item: ResourceItem) => {
    setUnlockItem(item);
    setUnlockCode('');
    setUnlockError('');
  };

  const submitUnlock = async () => {
    if (!unlockItem) return;
    setUnlockLoading(true);
    setUnlockError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/user/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ resourceId: unlockItem.id, code: unlockCode }),
      });
      const data = await res.json();
      if (data.success) {
        addToast('success', '解锁成功！');
        setUnlockItem(null);
        // 标记为已解锁
        setItems(prev => prev.map(it => it.id === unlockItem.id ? { ...it, unlocked: true } : it));
        if (data.lumenBalance !== undefined) setLumenBalance(data.lumenBalance);
        fetchItems(1, false);
      } else {
        setUnlockError(data.message || '解锁失败');
      }
    } catch { setUnlockError('网络错误'); }
    finally { setUnlockLoading(false); }
  };

  const totalPages = Math.ceil(total / 30);

  // 子页 header
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50 text-gray-900">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link href="/nonfilm" className={`w-10 h-10 bg-gradient-to-br ${accentColor} rounded-xl flex items-center justify-center`}>
                <span className="text-xl">{icon}</span>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{title}</h1>
                <p className="text-xs text-gray-500">{description} · 共 {total.toLocaleString()} 条</p>
              </div>
            </div>
            <Link href="/nonfilm" className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition">
              ← 非影视区
            </Link>
          </div>

          {/* 搜索 + 排序 + pageMode 切换 */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') fetchItems(1, false); }}
                placeholder={`搜索${title}...`}
                className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            </div>

            {/* 排序切换 */}
            <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
              <button
                onClick={() => setSort('cover_first')}
                className={`px-2.5 py-1 text-xs rounded transition ${sort === 'cover_first' ? 'bg-cyan-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                title="有封面的排前面"
              >🖼 封面优先</button>
              <button
                onClick={() => setSort('added_time')}
                className={`px-2.5 py-1 text-xs rounded transition ${sort === 'added_time' ? 'bg-cyan-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >🕐 最新</button>
            </div>

            {/* pageMode 切换 */}
            <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
              <button
                onClick={() => setPageMode('load')}
                className={`px-2.5 py-1 text-xs rounded transition ${pageMode === 'load' ? 'bg-violet-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >⬇ 加载更多</button>
              <button
                onClick={() => setPageMode('paging')}
                className={`px-2.5 py-1 text-xs rounded transition ${pageMode === 'paging' ? 'bg-violet-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >📄 真分页</button>
            </div>
          </div>

          {/* 来源筛选 */}
          <div className="flex gap-1.5 mt-2 overflow-x-auto">
            {SOURCES.map((src) => (
              <button
                key={src}
                onClick={() => setSource(src)}
                className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition ${
                  source === src
                    ? 'bg-cyan-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {src}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content - 列表布局无海报 */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {items.length === 0 && !loading ? (
          <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
            <div className="text-5xl mb-3">{icon}</div>
            <p className="text-gray-700 font-medium">该分类暂无数据</p>
            <p className="text-xs text-gray-400 mt-2 mb-4">原始 21-sheet Excel 中没有「{category}」分类，从未导入</p>
            <Link
              href="/admin/import"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg transition"
            >
              <span>📥</span><span>去后台导入数据</span>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="group flex items-center gap-3 bg-white border border-gray-100 hover:border-cyan-300 hover:shadow-sm rounded-xl p-3 transition cursor-pointer"
                onClick={() => setSelectedItem(item)}
              >
                {/* 封面缩略图 (cover_cache / music / sports) */}
                <div className="w-14 h-14 rounded-lg overflow-hidden bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center shrink-0">
                  {item.musicCover?.cover_url ? (
                    <img src={item.musicCover.cover_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : item.sportsCover?.badge_url ? (
                    <img src={item.sportsCover.badge_url} alt="" className="w-3/4 h-3/4 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : item.coverCache?.cover_url ? (
                    <img src={item.coverCache.cover_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <span className="text-2xl">{icon}</span>
                  )}
                </div>

                {/* Name + tags + meta */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm leading-tight line-clamp-1 text-gray-900">{item.name}</h3>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-gray-400">
                    <span className="px-1.5 py-0.5 bg-cyan-100 text-cyan-700 rounded">{item.source}</span>
                    {item.formatTags.slice(0, 3).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded">{t}</span>
                    ))}
                    {item.size && <span>📦 {item.size}</span>}
                    {item.musicCover?.artist && <span>🎤 {item.musicCover.artist}</span>}
                    {item.sportsCover?.team_name && <span>🏆 {item.sportsCover.team_name}</span>}
                  </div>
                </div>

                {/* 右侧操作 */}
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {item.payType === 'code' && !item.unlocked ? (
                    <button
                      onClick={() => openUnlock(item)}
                      className="px-3 py-1.5 bg-gradient-to-r from-yellow-500 to-amber-500 text-black text-xs rounded-lg font-medium"
                    >
                      💎 {item.lumenCost || 1} 解锁
                    </button>
                  ) : isMagnetOrEd2k(item.link) ? (
                    <button
                      onClick={() => handleCopyLink(item.link)}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs rounded-lg"
                    >
                      📋 复制
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDownload(item.id, item.link)}
                      className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg"
                    >
                      ⬇ 打开
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* 加载更多 / 真分页 */}
        {items.length > 0 && (
          <div className="mt-6">
            {pageMode === 'load' ? (
              items.length < total && (
                <div className="flex justify-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={loading}
                    className="px-8 py-2.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg disabled:opacity-50 text-sm text-gray-700"
                  >
                    {loading ? '加载中...' : `加载更多 (${total - items.length} 条)`}
                  </button>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center gap-1 flex-wrap">
                <button
                  onClick={() => handlePageChange(1)}
                  disabled={page === 1 || loading}
                  className="px-2.5 py-1.5 bg-white border border-gray-200 rounded text-xs disabled:opacity-30"
                >«</button>
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1 || loading}
                  className="px-2.5 py-1.5 bg-white border border-gray-200 rounded text-xs disabled:opacity-30"
                >‹</button>
                <span className="px-3 py-1.5 text-xs text-gray-600">
                  第 {page} / {totalPages || 1} 页
                </span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages || loading}
                  className="px-2.5 py-1.5 bg-white border border-gray-200 rounded text-xs disabled:opacity-30"
                >›</button>
                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={page >= totalPages || loading}
                  className="px-2.5 py-1.5 bg-white border border-gray-200 rounded text-xs disabled:opacity-30"
                >»</button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-3">
                <h2 className="text-lg font-bold text-gray-900 line-clamp-2 pr-4">{selectedItem.name}</h2>
                <button onClick={() => setSelectedItem(null)} className="p-1 hover:bg-gray-100 rounded text-gray-400 shrink-0">✕</button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <span className="px-2 py-0.5 bg-cyan-100 text-cyan-700 text-xs rounded">{selectedItem.source}</span>
                {selectedItem.formatTags.map((t) => (
                  <span key={t} className="px-2 py-0.5 bg-violet-100 text-violet-700 text-xs rounded">{t}</span>
                ))}
                {selectedItem.size && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">📦 {selectedItem.size}</span>}
              </div>
              {selectedItem.musicCover?.artist && <p className="text-sm text-gray-600 mb-1">🎤 {selectedItem.musicCover.artist} · {selectedItem.musicCover.album}</p>}
              {selectedItem.sportsCover?.team_name && <p className="text-sm text-gray-600 mb-1">🏆 {selectedItem.sportsCover.team_name} · {selectedItem.sportsCover.league}</p>}
              <button
                onClick={() => {
                  if (selectedItem.payType === 'code' && !selectedItem.unlocked) openUnlock(selectedItem);
                  else if (isMagnetOrEd2k(selectedItem.link)) handleCopyLink(selectedItem.link);
                  else handleDownload(selectedItem.id, selectedItem.link);
                }}
                className="w-full mt-3 p-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-medium flex items-center justify-center gap-2"
              >
                {selectedItem.payType === 'code' && !selectedItem.unlocked ? `💎 ${selectedItem.lumenCost || 1} 流明解锁` :
                  isMagnetOrEd2k(selectedItem.link) ? '📋 复制链接' : '⬇ 立即打开'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unlock Modal */}
      <AnimatePresence>
        {unlockItem && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
            onClick={() => setUnlockItem(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold mb-2">💎 解锁资源</h2>
              <p className="text-sm text-gray-600 mb-3">{unlockItem.name}</p>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3 text-sm">
                <p>消耗 <strong>{unlockItem.lumenCost || 1}</strong> 流明</p>
                <p className="text-xs text-gray-500 mt-1">当前余额: {lumenBalance} 流明</p>
              </div>
              <input
                type="text"
                value={unlockCode}
                onChange={(e) => setUnlockCode(e.target.value.toUpperCase())}
                placeholder="输入激活码 (LUMEN-XXX 或 VIP-XXX)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2"
              />
              {unlockError && <p className="text-red-500 text-xs mb-2">{unlockError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setUnlockItem(null)} className="flex-1 py-2 bg-gray-100 rounded-lg text-sm">取消</button>
                <button onClick={submitUnlock} disabled={unlockLoading} className="flex-1 py-2 bg-cyan-600 text-white rounded-lg text-sm disabled:opacity-50">
                  {unlockLoading ? '解锁中...' : '解锁'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-2 rounded-lg text-sm shadow-lg ${
            t.type === 'error' ? 'bg-red-500 text-white' :
            t.type === 'success' ? 'bg-green-500 text-white' : 'bg-gray-800 text-white'
          }`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}
