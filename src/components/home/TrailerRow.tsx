'use client';
// 2026-08-05: TMDB 最新预告片模块
//   - 4ktop 风格: 标题 + Tab (热门 / 影院上映中) + 横向滚动视频卡
//   - 视频卡: 16:9 缩略图 + 中央 ▶️ + 标题 + 简介 (跟 TMDB 网站一致)
//   - 点击弹 modal iframe 嵌 YouTube 播放
//   - 数据源: /api/tmdb/videos?tab=trending|now_playing

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, X, ChevronLeft, ChevronRight } from 'lucide-react';

interface Trailer {
  id: string;
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  originalTitle: string;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  backdrop: string;
  poster: string;
  videoKey: string;
  videoSite: string;
  videoName: string;
  videoType: string;
  videoOfficial: boolean;
}

type TabKey = 'trending' | 'now_playing';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'trending', label: '热门' },
  { key: 'now_playing', label: '影院上映中' },
];

export default function TrailerRow() {
  const [tab, setTab] = useState<TabKey>('trending');
  const [items, setItems] = useState<Trailer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTrailer, setActiveTrailer] = useState<Trailer | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  // 拉数据
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    fetch(`/api/tmdb/videos?tab=${tab}&lang=zh-CN&limit=12`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setItems(data.items || []);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || '网络错误');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab]);

  // 滚动箭头状态
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 10);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
    };
    update();
    el.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [items.length]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -el.clientWidth * 0.8 : el.clientWidth * 0.8, behavior: 'smooth' });
  };

  // 关闭 modal
  useEffect(() => {
    if (!activeTrailer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveTrailer(null); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [activeTrailer]);

  return (
    <section className="mb-6">
      {/* 标题 + Tab */}
      <div className="flex items-center gap-3 mb-3 px-1 flex-wrap">
        <h2 className="text-base sm:text-lg font-bold text-cyan-300">最新预告片</h2>
        <div className="inline-flex rounded-full bg-white/[0.04] border border-white/[0.06] p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 sm:px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                tab === t.key
                  ? 'bg-gradient-to-r from-cyan-500/30 to-blue-500/30 text-white border border-cyan-400/30'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {activeTrailer && (
          <span className="text-[10px] text-white/30 ml-auto">点击视频关闭 (Esc)</span>
        )}
      </div>

      {/* 视频横向滚动 */}
      {error ? (
        <div className="px-4 py-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] text-rose-200 text-sm">
          预告片加载失败: {error}
        </div>
      ) : loading || items.length === 0 ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[260px] sm:w-[300px] aspect-video rounded-xl bg-white/[0.03] animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="relative group/sec">
          {/* 左箭头 */}
          {canLeft && (
            <button
              onClick={() => scroll('left')}
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur text-white/80 hover:text-white flex items-center justify-center opacity-0 group-hover/sec:opacity-100 transition shadow-lg"
              aria-label="左移"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {/* 右箭头 */}
          {canRight && (
            <button
              onClick={() => scroll('right')}
              className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur text-white/80 hover:text-white flex items-center justify-center opacity-0 group-hover/sec:opacity-100 transition shadow-lg"
              aria-label="右移"
            >
              <ChevronRight size={20} />
            </button>
          )}

          <div
            ref={scrollerRef}
            className="flex gap-3 overflow-x-auto pb-2 scroll-smooth"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
          >
            {items.map((t, i) => (
              <motion.button
                key={t.id}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03, duration: 0.3 }}
                onClick={() => setActiveTrailer(t)}
                className="flex-shrink-0 w-[260px] sm:w-[300px] text-left group/card"
              >
                {/* 16:9 缩略图 */}
                <div className="relative aspect-video rounded-xl overflow-hidden bg-white/5 mb-2 ring-1 ring-white/5 group-hover/card:ring-cyan-400/40 transition">
                  {t.backdrop ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={t.backdrop}
                      alt={t.title}
                      className="w-full h-full object-cover group-hover/card:scale-105 transition duration-500"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl text-white/10">
                      🎬
                    </div>
                  )}
                  {/* 暗化层 + ▶️ 按钮 */}
                  <div className="absolute inset-0 bg-black/30 group-hover/card:bg-black/50 transition flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-white/90 group-hover/card:bg-white flex items-center justify-center shadow-xl group-hover/card:scale-110 transition">
                      <Play size={22} className="text-slate-900 ml-1" fill="currentColor" />
                    </div>
                  </div>
                  {/* 角标: Trailer/Teaser + 类型 */}
                  <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
                    <span className="px-1.5 py-0.5 rounded bg-black/70 text-[9px] text-white/90 backdrop-blur">
                      {t.type === 'movie' ? '🎬' : '📺'}
                    </span>
                    {t.videoType && (
                      <span className="px-1.5 py-0.5 rounded bg-cyan-500/80 text-[9px] text-white font-medium backdrop-blur">
                        {t.videoType}
                      </span>
                    )}
                  </div>
                  {/* 评分 */}
                  {t.voteAverage > 0 && (
                    <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-yellow-300 backdrop-blur">
                      ★ {t.voteAverage.toFixed(1)}
                    </div>
                  )}
                </div>
                {/* 标题 */}
                <h3 className="text-sm font-semibold text-white/90 line-clamp-1 group-hover/card:text-cyan-300 transition">
                  {t.title || t.originalTitle || '未命名'}
                </h3>
                {/* 简介 */}
                <p className="text-[11px] text-white/40 mt-0.5 line-clamp-2 leading-relaxed">
                  {t.overview || t.videoName || '—'}
                </p>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* 播放 modal */}
      <AnimatePresence>
        {activeTrailer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setActiveTrailer(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-5xl bg-[#0a0a0f] rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 关闭按钮 */}
              <button
                onClick={() => setActiveTrailer(null)}
                className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur text-white/80 hover:text-white flex items-center justify-center transition"
                aria-label="关闭"
              >
                <X size={18} />
              </button>

              {/* iframe */}
              <div className="relative" style={{ paddingBottom: '56.25%' }}>
                {activeTrailer.videoSite === 'YouTube' ? (
                  <iframe
                    key={activeTrailer.videoKey}
                    src={`https://www.youtube.com/embed/${activeTrailer.videoKey}?autoplay=1&rel=0&modestbranding=1`}
                    className="absolute inset-0 w-full h-full"
                    frameBorder={0}
                    allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                    allowFullScreen
                    title={`${activeTrailer.title} 预告片`}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-white/60">
                    视频源不支持嵌入
                  </div>
                )}
              </div>

              {/* 标题区 */}
              <div className="px-5 py-4 border-t border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 text-[10px] font-medium">
                    {activeTrailer.videoType || 'Trailer'}
                  </span>
                  <span className="text-[10px] text-white/40">
                    {activeTrailer.videoOfficial ? '官方' : '非官方'} · {activeTrailer.videoSite}
                  </span>
                </div>
                <h3 className="text-base font-bold text-white line-clamp-1">
                  {activeTrailer.title}
                </h3>
                {activeTrailer.originalTitle && activeTrailer.originalTitle !== activeTrailer.title && (
                  <p className="text-xs text-white/40 mt-0.5 line-clamp-1">{activeTrailer.originalTitle}</p>
                )}
                {activeTrailer.overview && (
                  <p className="text-xs text-white/60 mt-2 line-clamp-2 leading-relaxed">{activeTrailer.overview}</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
