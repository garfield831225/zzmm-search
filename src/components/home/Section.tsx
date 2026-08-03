'use client';
// 2026-08-04: 首页 4ktop 风格模块行
//   - 模块标题 + emoji + "更多" 链接
//   - 横向滚动卡片 12 张 (mobile 4, tablet 6, desktop 12)
//   - 复用卡片样式 (跟 /upcoming /basic /vip /themes 页面一致)

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Sparkles, Crown, Tag, Calendar } from 'lucide-react';
import { motion } from 'framer-motion';

export interface SectionItem {
  id: number;
  tmdbId?: string;
  title: string;
  posterUrl: string;
  backdropPath?: string;
  releaseDate?: string;
  voteAverage?: number;
  source?: string;
  resourceCount?: number;
  accessLevel?: string;
  importChannel?: string;
  payType?: string;
  category?: string;
  tmdbType?: 'movie' | 'tv';
}

interface SectionProps {
  title: string;
  titleEn?: string;
  emoji?: string;
  href?: string;          // "查看更多" 链接
  items: SectionItem[];
  accent?: 'cyan' | 'violet' | 'amber' | 'pink' | 'emerald';
  loading?: boolean;
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const TMDB_FALLBACK = 'https://image.tmdb.org/t/p/w500/7bUqJAuI5LFiJ6xMcLQ2E3YL8w1a.jpg';

const accentColor: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  cyan:    { bg: 'from-cyan-500/10 to-blue-500/10',    text: 'text-cyan-300',    border: 'border-cyan-500/30',    glow: 'shadow-cyan-500/10' },
  violet:  { bg: 'from-violet-500/10 to-purple-500/10', text: 'text-violet-300',  border: 'border-violet-500/30',  glow: 'shadow-violet-500/10' },
  amber:   { bg: 'from-amber-500/10 to-orange-500/10',  text: 'text-amber-300',   border: 'border-amber-500/30',   glow: 'shadow-amber-500/10' },
  pink:    { bg: 'from-pink-500/10 to-rose-500/10',     text: 'text-pink-300',    border: 'border-pink-500/30',    glow: 'shadow-pink-500/10' },
  emerald: { bg: 'from-emerald-500/10 to-green-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/10' },
};

export default function HomeSection({ title, titleEn, emoji, href, items, accent = 'cyan', loading }: SectionProps) {
  const color = accentColor[accent] || accentColor.cyan;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const updateArrows = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 10);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
  };

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows);
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [items.length]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.8;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <section className="mb-6">
      {/* 模块标题 */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          {emoji && <span className="text-xl">{emoji}</span>}
          <h2 className={`text-base sm:text-lg font-bold ${color.text}`}>
            {title}
            {titleEn && <span className="ml-2 text-[10px] sm:text-xs text-white/40 font-normal tracking-wider uppercase">{titleEn}</span>}
          </h2>
        </div>
        {href && (
          <Link
            href={href}
            className="flex items-center gap-0.5 text-xs text-white/50 hover:text-white transition"
          >
            查看更多 <ChevronRight size={14} />
          </Link>
        )}
      </div>

      {/* 卡片横向滚动 */}
      {loading || items.length === 0 ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-[140px] sm:w-[160px] aspect-[2/3] rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="relative group/sec">
          {/* 左箭头 */}
          {canLeft && (
            <button
              onClick={() => scroll('left')}
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur text-white/80 hover:text-white flex items-center justify-center opacity-0 group-hover/sec:opacity-100 transition shadow-lg"
              aria-label="左移"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {/* 右箭头 */}
          {canRight && (
            <button
              onClick={() => scroll('right')}
              className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur text-white/80 hover:text-white flex items-center justify-center opacity-0 group-hover/sec:opacity-100 transition shadow-lg"
              aria-label="右移"
            >
              <ChevronRight size={18} />
            </button>
          )}

          <div
            ref={scrollerRef}
            className="flex gap-3 overflow-x-auto pb-2 scroll-smooth"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
          >
            {items.map((it, i) => (
              <motion.div
                key={it.id + '-' + i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02, duration: 0.3 }}
                className="flex-shrink-0 w-[140px] sm:w-[160px] cursor-pointer group/card"
                onClick={() => {
                  if (it.tmdbId) {
                    location.href = `/upcoming/${it.id}`;
                  } else {
                    location.href = `/titles`;
                  }
                }}
              >
                {/* 海报 */}
                <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-1.5 ring-1 ring-white/5 group-hover/card:ring-violet-400/40 transition">
                  <img
                    src={it.posterUrl || TMDB_FALLBACK}
                    alt={it.title}
                    className="w-full h-full object-cover group-hover/card:scale-105 transition duration-500"
                    onError={(e: any) => { e.target.src = TMDB_FALLBACK; }}
                    loading="lazy"
                  />
                  {/* 类型/年份标签 */}
                  <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 items-start">
                    {it.tmdbType && (
                      <span className="px-1.5 py-0.5 rounded bg-black/70 text-[9px] text-white/90 backdrop-blur">
                        {it.tmdbType === 'movie' ? '🎬' : '📺'}
                      </span>
                    )}
                    {it.importChannel === 'zezhe' && (
                      <span className="px-1.5 py-0.5 rounded bg-gradient-to-r from-violet-500/80 to-pink-500/80 text-[9px] text-white font-medium">
                        👑 泽泽妈
                      </span>
                    )}
                    {it.accessLevel === 'vip' && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/80 text-[9px] text-white font-medium">
                        🔒 VIP
                      </span>
                    )}
                    {it.payType === 'code' && (
                      <span className="px-1.5 py-0.5 rounded bg-purple-500/80 text-[9px] text-white font-medium">
                        💰 解锁
                      </span>
                    )}
                  </div>
                  {/* 评分 */}
                  {it.voteAverage != null && it.voteAverage > 0 && (
                    <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-yellow-300 backdrop-blur">
                      ★ {it.voteAverage.toFixed(1)}
                    </div>
                  )}
                </div>
                {/* 标题 */}
                <h3 className="text-xs font-medium text-white/90 line-clamp-1 group-hover/card:text-violet-300 transition">
                  {it.title}
                </h3>
                {/* 年份 + 源 */}
                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-white/40">
                  {it.releaseDate && <span>{it.releaseDate.slice(0, 4)}</span>}
                  {it.source && <span className="uppercase">· {it.source}</span>}
                </div>
              </motion.div>
            ))}
            {/* "更多" 占位卡 */}
            {href && (
              <div className="flex-shrink-0 w-[140px] sm:w-[160px] flex items-center justify-center">
                <Link
                  href={href}
                  className={`w-full aspect-[2/3] rounded-xl border-2 border-dashed ${color.border} bg-gradient-to-br ${color.bg} flex flex-col items-center justify-center gap-2 text-sm ${color.text} hover:scale-105 transition shadow-lg ${color.glow}`}
                >
                  <ChevronRight size={28} />
                  <span>查看更多</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
