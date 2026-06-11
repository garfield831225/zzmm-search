'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

// 拿 localStorage token (兼容多个 key)
function getAuthHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const t = localStorage.getItem('zzmm_token')
    || localStorage.getItem('token')
    || localStorage.getItem('adminToken');
  return t ? { Authorization: 'Bearer ' + t } : {};
}

interface Game {
  id: number;
  name: string;
  platform: string;
  sub_platform: string | null;
  cover_url: string | null;
  description: string | null;
  size: string | null;
  source: string | null;
  release_date: string | null;
  publisher: string | null;
  developer: string | null;
  language: string | null;
  match_status: string;
  is_vip_only: boolean;
  view_count: number;
  created_at: string;
}

interface Platform {
  platform: string;
  count: number;
}

const PLATFORM_ICONS: Record<string, string> = {
  Switch: '🎮',
  PS5: '🎮',
  PS4: '🎮',
  PS3: '🎮',
  PS2: '🎮',
  PSP: '🎮',
  Xbox: '🎮',
  Xbox360: '🎮',
  '3DS': '🎮',
  Wii: '🎮',
  PC: '💻',
  Steam: '💻',
};

// 平台配色
const PLATFORM_COLORS: Record<string, string> = {
  Switch: 'from-red-500 to-red-700',
  PS5: 'from-blue-500 to-blue-700',
  PS4: 'from-blue-400 to-blue-600',
  PS3: 'from-blue-300 to-blue-500',
  PS2: 'from-slate-400 to-slate-600',
  PSP: 'from-slate-300 to-slate-500',
  Xbox: 'from-green-500 to-green-700',
  Xbox360: 'from-green-400 to-green-600',
  '3DS': 'from-red-400 to-red-600',
  Wii: 'from-cyan-400 to-cyan-600',
  PC: 'from-purple-500 to-purple-700',
  Steam: 'from-indigo-500 to-indigo-700',
};

// SVG 用纯 ASCII 字符避免 btoa 报错
const FALLBACK_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#374151"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><text x="200" y="300" text-anchor="middle" fill="#9ca3af" font-size="120" font-family="sans-serif">&#127918;</text><text x="200" y="400" text-anchor="middle" fill="#6b7280" font-size="24" font-family="sans-serif">No Cover</text></svg>`);

export default function GamesPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [activePlatform, setActivePlatform] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<Game[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ id: number; msg: string; type: 'success' | 'error' } | null>(null);
  let toastCounter = 0;

  const addToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastCounter;
    setToast({ id, msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 加载平台
  useEffect(() => {
    fetch('/api/games/platforms', { credentials: 'include', headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setPlatforms(d.platforms || []);
      })
      .catch(() => {});
  }, []);

  // 加载游戏列表
  const loadGames = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activePlatform) params.set('platform', activePlatform);
      if (keyword) params.set('q', keyword);
      params.set('page', String(page));
      params.set('pageSize', '24');

      const r = await fetch(`/api/games?${params}`, { credentials: 'include', headers: getAuthHeaders() });
      // 关键修复: 即使 r.json() 失败也诊断
      const text = await r.text();
      console.log('[games API]', r.status, 'content-type:', r.headers.get('content-type'), 'body:', text.slice(0, 300));
      let d: any;
      try {
        d = JSON.parse(text);
      } catch (e: any) {
        console.error('[games JSON parse failed]', e.message, 'raw:', text.slice(0, 500));
        addToast('API 返回非 JSON: ' + (text.slice(0, 80) || '空响应 (status=' + r.status + ')'), 'error');
        setItems([]);
        setTotal(0);
        return;
      }
      if (!d.ok) {
        if (d.need === 'vip' || d.need === 'basic') {
          addToast(d.tip || '需要升级会员', 'error');
        } else if (d.needLogin || r.status === 401) {
          // token 失效, 清 localStorage 跳登录
          localStorage.removeItem('zzmm_token');
          localStorage.removeItem('token');
          localStorage.removeItem('adminToken');
          addToast('登录已过期, 请重新登录', 'error');
          setTimeout(() => { window.location.href = '/login?redirect=/games'; }, 1500);
        } else {
          addToast(d.error || '加载失败', 'error');
        }
        setItems([]);
        setTotal(0);
        return;
      }
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch (e: any) {
      console.error('[games loadGames error]', e);
      addToast('加载失败: ' + (e?.message || '网络错误'), 'error');
    } finally {
      setLoading(false);
    }
  }, [activePlatform, keyword, page, addToast]);

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadGames();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <span>🎮</span>
                <span>游戏中心</span>
                <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">
                  👑 VIP 专属
                </span>
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                掌机 / PC / 全平台 · 共 <span className="text-amber-400 font-bold">{total}</span> 款游戏
              </p>
            </div>
            <Link
              href="/library"
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              ← 返回内容中心
            </Link>
          </div>

          {/* 搜索 + 平台筛选 */}
          <form onSubmit={handleSearch} className="flex gap-2 mb-3">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索游戏名..."
              className="flex-1 px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-900 font-medium rounded-lg text-sm disabled:opacity-50"
            >
              搜索
            </button>
          </form>

          {/* 平台 tab */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => { setActivePlatform(''); setPage(1); }}
              className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-all ${
                !activePlatform
                  ? 'bg-amber-500 text-slate-900 font-medium'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              全部
            </button>
            {platforms.map((p) => (
              <button
                key={p.platform}
                onClick={() => { setActivePlatform(p.platform); setPage(1); }}
                className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-all flex items-center gap-1 ${
                  activePlatform === p.platform
                    ? 'bg-amber-500 text-slate-900 font-medium'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <span>{PLATFORM_ICONS[p.platform] || '🎮'}</span>
                <span>{p.platform}</span>
                <span className="text-xs opacity-70">({p.count})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {loading && items.length === 0 ? (
          <div className="text-center py-20 text-slate-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🎮</div>
            <p className="text-slate-400 mb-2">暂无游戏资源</p>
            <p className="text-sm text-slate-500">
              正在筹备中, 敬请期待
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {items.map((g) => (
                <motion.div
                  key={g.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group relative bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-amber-500/50 transition-all hover:scale-[1.02] cursor-pointer"
                  onClick={() => window.location.href = `/games/${g.id}`}
                >
                  {/* 封面 */}
                  <div className="relative aspect-[3/4] bg-gradient-to-br from-slate-800 to-slate-900">
                    <img
                      src={g.cover_url || FALLBACK_COVER}
                      alt={g.name}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_COVER; }}
                    />
                    {/* 平台 badge */}
                    <div className={`absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-medium text-white bg-gradient-to-r ${PLATFORM_COLORS[g.platform] || 'from-slate-500 to-slate-700'}`}>
                      {g.platform}
                    </div>
                    {/* VIP 锁 */}
                    {g.is_vip_only && (
                      <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/90 text-slate-900">
                        👑 VIP
                      </div>
                    )}
                    {/* 匹配中 */}
                    {g.match_status === 'pending' && (
                      <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-xs bg-slate-900/80 text-slate-400">
                        📷 待匹配
                      </div>
                    )}
                  </div>
                  {/* 信息 */}
                  <div className="p-3">
                    <h3 className="font-medium text-sm line-clamp-2 mb-1 group-hover:text-amber-400 transition-colors">
                      {g.name}
                    </h3>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      {g.size && <span>💾 {g.size}</span>}
                      {g.language && <span>🌐 {g.language}</span>}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* 分页 */}
            {total > 24 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-sm"
                >
                  ← 上一页
                </button>
                <span className="text-sm text-slate-400 px-3">
                  第 {page} 页 · 共 {Math.ceil(total / 24)} 页
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= Math.ceil(total / 24)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-sm"
                >
                  下一页 →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 px-5 py-3 rounded-lg shadow-2xl z-50 ${
              toast.type === 'error' ? 'bg-red-500/90' : 'bg-amber-500/90 text-slate-900'
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
