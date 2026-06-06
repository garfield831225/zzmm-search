'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Script from 'next/script';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Search, Lock, Star, X, ExternalLink, Library, Play } from 'lucide-react';

interface VipVideo {
  thumb: string;
  playUrl: string;
  title: string;
  sub1?: string;
  sub2?: string;
  badge?: string;
  duration?: string;
  desc?: string;
  external?: string;
}

const TABS = [
  { key: 'pixabay',   label: '🎬 Pixabay' },
  { key: 'pexels',    label: '🎥 Pexels' },
  { key: 'bilibili',  label: '📺 B站热榜' },
  { key: 'nasa',      label: '🌌 NASA 天文' },
  { key: 'tmdb',      label: '🎞️ 热门影视' },
  { key: 'archive',   label: '📼 经典片库' },
];

export default function VipVideosPage() {
  const [tab, setTab] = useState('pixabay');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<VipVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);  // VIP 锁
  const [hasMore, setHasMore] = useState(true);
  const [playing, setPlaying] = useState<VipVideo | null>(null);

  const fetchData = useCallback(async (reset = true) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/vip-videos/search?source=${tab}&q=${encodeURIComponent(q)}&page=${page}`);
      if (r.status === 401 || r.status === 403) {
        setLocked(true);
        setItems([]);
        return;
      }
      const d = await r.json();
      if (d.error) {
        setError(d.error);
        if (reset) setItems([]);
      } else {
        if (reset) setItems(d.items || []);
        else setItems(prev => [...prev, ...(d.items || [])]);
        setHasMore(!!d.hasMore);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tab, q, page]);

  useEffect(() => { setPage(1); fetchData(true); }, [tab]);
  useEffect(() => { if (page > 1) fetchData(false); }, [page]);

  const onSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    setPage(1);
    fetchData(true);
  };

  if (locked) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold mb-2">VIP 视频区</h1>
          <p className="text-white/60 mb-6">
            本区域聚合 <b className="text-violet-300">Pixabay / Pexels / B站 / NASA / TMDB / Internet Archive</b> 6 个公开视频源，<br />
            <b className="text-amber-300">需要 VIP 会员</b>才能访问
          </p>
          <div className="flex gap-3">
            <Link href="/tmdb-films" className="flex-1 py-3 bg-white/10 rounded-xl text-sm font-medium">
              ← 返回影视区
            </Link>
            <Link href="/shop" className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl text-sm font-medium">
              购买 VIP
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0a0f] via-[#0d0d18] to-[#0a0a0f] text-white">
      <Script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js" strategy="beforeInteractive" />
      <div className="sticky top-0 z-30 bg-[#0a0a0f]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href="/tmdb-films" className="p-2 hover:bg-white/10 rounded-lg">
                <Library className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent flex items-center gap-2">
                  <Lock className="w-4 h-4 text-violet-400" /> VIP 视频区
                </h1>
                <p className="text-xs text-white/40">6 个公开源聚合播放 · 0 服务器带宽</p>
              </div>
            </div>
            <form onSubmit={onSearch} className="flex-1 max-w-md relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="搜索：日落、星际、动作片..."
                className="w-full bg-white/5 border border-white/10 rounded-full pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-violet-500"
              />
            </form>
          </div>
          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition ${
                  tab === t.key
                    ? 'bg-gradient-to-r from-violet-600 to-pink-600 text-white shadow-lg shadow-violet-500/30'
                    : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {error && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm">
            ⚠️ {error}
          </div>
        )}
        {loading && items.length === 0 ? (
          <div className="text-center py-20 text-white/40">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-white/40">没找到内容，换个关键词试试</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {items.map((it, idx) => (
              <Card key={idx} item={it} onPlay={() => setPlaying(it)} />
            ))}
          </div>
        )}
        {hasMore && items.length > 0 && (
          <div className="mt-8 text-center">
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={loading}
              className="px-6 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-medium disabled:opacity-50"
            >
              {loading ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {playing && <PlayerModal item={playing} onClose={() => setPlaying(null)} />}
      </AnimatePresence>
    </div>
  );
}

function Card({ item, onPlay }: { item: VipVideo; onPlay: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onPlay}
      className="group cursor-pointer"
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-gray-800 transition-all duration-300 group-hover:scale-105 group-hover:shadow-2xl group-hover:shadow-violet-500/30">
        {item.thumb ? (
          <img src={item.thumb} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-3xl">🎬</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        {item.badge && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur rounded text-[10px] font-medium">
            {item.badge}
          </div>
        )}
        {item.duration && (
          <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 rounded text-[10px] font-mono">
            {item.duration}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
          <div className="w-12 h-12 rounded-full bg-violet-500/80 backdrop-blur flex items-center justify-center">
            <Play className="w-6 h-6 text-white fill-white" />
          </div>
        </div>
      </div>
      <div className="mt-2">
        <h3 className="text-white text-sm font-medium line-clamp-2 group-hover:text-violet-300 transition">{item.title}</h3>
        {(item.sub1 || item.sub2) && (
          <p className="text-white/40 text-xs mt-0.5 line-clamp-1">{[item.sub1, item.sub2].filter(Boolean).join(' · ')}</p>
        )}
      </div>
    </motion.div>
  );
}

function PlayerModal({ item, onClose }: { item: VipVideo; onClose: () => void }) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const v = playerRef.current;
    if (!v) return;
    const url = item.playUrl;
    if (!url) { setFallback(true); return; }
    if (url.includes('.m3u8') && (window as any).Hls?.isSupported()) {
      const Hls = (window as any).Hls;
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(v);
      return () => hls.destroy();
    } else {
      v.src = url;
    }
  }, [item]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        className="bg-[#0a0a0f] border border-white/10 rounded-2xl max-w-4xl w-full overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="font-medium truncate pr-4">{item.title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4" /></button>
        </div>
        <div className="aspect-video bg-black">
          {fallback ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-white/60">
              <div className="text-4xl mb-3">📭</div>
              <div>该视频无法在此页面内直接播放</div>
              {item.external && (
                <a href={item.external} target="_blank" rel="noopener" className="mt-3 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium flex items-center gap-2">
                  <ExternalLink className="w-3 h-3" /> 在新窗口打开
                </a>
              )}
            </div>
          ) : (
            <video ref={playerRef} controls autoPlay playsInline className="w-full h-full" />
          )}
        </div>
        {item.desc && (
          <div className="p-4 text-sm text-white/60 line-clamp-3">{item.desc}</div>
        )}
      </motion.div>
    </motion.div>
  );
}
