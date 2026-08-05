'use client';
// 2026-08-04: 首页顶部 banner 大图轮播 (4ktop 风格)
//   - 5 张大图 + 渐变遮罩 + 标题/简介
//   - 自动播放 6s, 圆点指示 + 左右按钮
//   - 接 /api/upcoming 头部 high-vote 数据

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import Link from 'next/link';

interface BannerItem {
  id: number;
  tmdbId: string;
  tmdbType: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  overview: string;
  releaseDate: string;
  posterPath: string;
  backdropPath?: string;
  posterUrl: string;
  voteAverage: number;
  source: string;
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';  // 2026-08-05: w1280→w780 节省 50% 流量

export default function HomeBanner() {
  const [items, setItems] = useState<BannerItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // 加载 /api/upcoming top 5
  useEffect(() => {
    fetch('/api/upcoming?type=all&pageSize=5')
      .then(r => r.json())
      .then(d => {
        if (d?.items) setItems(d.items);
      })
      .catch(() => {});
  }, []);

  // autoplay 6s
  useEffect(() => {
    if (paused || items.length === 0) return;
    const t = setInterval(() => setIdx(i => (i + 1) % items.length), 6000);
    return () => clearInterval(t);
  }, [paused, items.length]);

  if (items.length === 0) {
    // skeleton
    return (
      <div className="relative w-full aspect-[16/6] sm:aspect-[16/5] rounded-2xl overflow-hidden bg-gradient-to-br from-violet-900/30 to-pink-900/30 animate-pulse">
        <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">
          🎬 正在加载推荐...
        </div>
      </div>
    );
  }

  const cur = items[idx];
  const bgUrl = cur.backdropPath
    ? `${TMDB_IMG}${cur.backdropPath}`
    : (cur.posterPath ? `${TMDB_IMG}${cur.posterPath}` : cur.posterUrl);

  return (
    <div
      className="relative w-full aspect-[16/6] sm:aspect-[16/5] md:aspect-[16/4.5] rounded-2xl overflow-hidden group"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={cur.id}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${bgUrl})` }}
          />
          {/* 双层渐变遮罩: 左侧黑 + 底部黑 */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
        </motion.div>
      </AnimatePresence>

      {/* 文字信息 */}
      <div className="absolute inset-0 flex items-end p-5 sm:p-8 md:p-10">
        <div className="max-w-2xl text-white">
          <AnimatePresence mode="wait">
            <motion.div
              key={cur.id + '-info'}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4 }}
            >
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className="px-2 py-0.5 rounded bg-violet-500/80 text-white font-medium">
                  {cur.tmdbType === 'movie' ? '🎬 电影' : '📺 剧集'}
                </span>
                {cur.releaseDate && (
                  <span className="text-white/70">{cur.releaseDate.slice(0, 4)}</span>
                )}
                {cur.voteAverage > 0 && (
                  <span className="text-yellow-300">★ {cur.voteAverage.toFixed(1)}</span>
                )}
                <span className="text-white/50 uppercase text-[10px]">{cur.source}</span>
              </div>
              <h2 className="text-xl sm:text-2xl md:text-4xl font-bold mb-2 line-clamp-1">
                {cur.title}
              </h2>
              {cur.originalTitle && cur.originalTitle !== cur.title && (
                <p className="text-xs sm:text-sm text-white/60 mb-2 line-clamp-1">{cur.originalTitle}</p>
              )}
              <p className="text-xs sm:text-sm text-white/80 line-clamp-2 sm:line-clamp-3 mb-3 max-w-xl">
                {cur.overview || '暂无简介'}
              </p>
              <Link
                href={`/upcoming/${cur.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-pink-600 hover:opacity-90 text-sm font-medium transition shadow-lg"
              >
                <Play size={14} /> 查看详情
              </Link>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* 左右按钮 */}
      <button
        onClick={() => setIdx(i => (i - 1 + items.length) % items.length)}
        className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur text-white/80 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
        aria-label="上一张"
      >
        <ChevronLeft size={20} />
      </button>
      <button
        onClick={() => setIdx(i => (i + 1) % items.length)}
        className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur text-white/80 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
        aria-label="下一张"
      >
        <ChevronRight size={20} />
      </button>

      {/* 圆点指示 */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
        {items.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={`transition-all rounded-full ${i === idx
              ? 'bg-white w-6 h-1.5'
              : 'bg-white/40 hover:bg-white/60 w-1.5 h-1.5'
            }`}
            aria-label={`第 ${i + 1} 张`}
          />
        ))}
      </div>
    </div>
  );
}
