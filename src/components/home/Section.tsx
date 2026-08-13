'use client';
// 2026-08-04 P9.3: 卡片 onClick 路由修复
//   - VIP 资源 (accessLevel==='vip' 或 importChannel 是 zezhe) → 跳 /vip/[id] 业务页 (playerla + m3u8 视频播放)
//   - 其他资源 → 跳 /tmdb/[type]/[tmdbId] 通用详情页 (下载链接 + 解锁)
//   - it.id 来自 /api/upcoming|basic|vip 列表的 resourceId (xx_resources.id 主键)

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
  sourceDisplay?: string;   // 2026-08-09: 网盘资源显示名 (百度网盘/夸克/磁力 等)
  size?: string;             // 2026-08-09: 网盘资源大小 (2.5GB)
  resourceCount?: number;
  accessLevel?: string;
  importChannel?: string;
  payType?: string;
  category?: string;
  tmdbType?: 'movie' | 'tv';
  link?: string;             // 2026-08-09: 网盘直链, linkMode 时卡片 onClick 直接开
  lumenCost?: number;        // 2026-08-09: 流明消耗 (code payType 用)
  noPoster?: boolean;        // 2026-08-09: true 时走 source 卡片 (无海报, 用 source icon 兜底)
  isShortDrama?: boolean;    // 2026-08-14: 短剧打标 (不影响分类, 纯 tag)
}

interface SectionProps {
  title: string;
  titleEn?: string;
  emoji?: string;
  href?: string;          // "查看更多" 链接
  items: SectionItem[];
  accent?: 'cyan' | 'violet' | 'amber' | 'pink' | 'emerald';
  loading?: boolean;
  linkMode?: boolean;     // 2026-08-09: 网盘资源模式, 卡片 onClick 直接 window.open(it.link) 不跳详情页
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const TMDB_FALLBACK = 'https://image.tmdb.org/t/p/w500/7bUqJAuI5LFiJ6xMcLQ2E3YL8w1a.jpg';

// 2026-08-09: 网盘资源卡片配色 (noPoster 模式用)
//  - source key 是 source 字段 (baidu/quark/aliyun/magnet/ed2k 等)
//  - 没匹配到的用默认灰
const SOURCE_META: Record<string, { emoji: string; gradient: string; text: string }> = {
  baidu:    { emoji: '💾', gradient: 'from-blue-500/40 to-cyan-500/30',    text: 'text-blue-200' },
  quark:    { emoji: '⚡', gradient: 'from-violet-500/40 to-fuchsia-500/30', text: 'text-violet-200' },
  aliyun:   { emoji: '☁️', gradient: 'from-orange-500/40 to-amber-500/30',  text: 'text-orange-200' },
  ali:      { emoji: '☁️', gradient: 'from-orange-500/40 to-amber-500/30',  text: 'text-orange-200' },
  magnet:   { emoji: '🧲', gradient: 'from-rose-500/40 to-pink-500/30',     text: 'text-rose-200' },
  ed2k:     { emoji: '🔗', gradient: 'from-emerald-500/40 to-teal-500/30',  text: 'text-emerald-200' },
  thunder:  { emoji: '⚡', gradient: 'from-sky-500/40 to-blue-500/30',      text: 'text-sky-200' },
  xunlei:   { emoji: '⚡', gradient: 'from-sky-500/40 to-blue-500/30',      text: 'text-sky-200' },
  uc:       { emoji: '☁️', gradient: 'from-red-500/40 to-orange-500/30',    text: 'text-red-200' },
  '115':    { emoji: '📦', gradient: 'from-green-500/40 to-emerald-500/30', text: 'text-green-200' },
  default:  { emoji: '📁', gradient: 'from-slate-500/40 to-gray-500/30',   text: 'text-slate-200' },
};
function getSourceMeta(src?: string) {
  if (!src) return SOURCE_META.default;
  return SOURCE_META[src.toLowerCase()] || SOURCE_META.default;
}

const accentColor: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  cyan:    { bg: 'from-cyan-500/10 to-blue-500/10',    text: 'text-cyan-300',    border: 'border-cyan-500/30',    glow: 'shadow-cyan-500/10' },
  violet:  { bg: 'from-violet-500/10 to-purple-500/10', text: 'text-violet-300',  border: 'border-violet-500/30',  glow: 'shadow-violet-500/10' },
  amber:   { bg: 'from-amber-500/10 to-orange-500/10',  text: 'text-amber-300',   border: 'border-amber-500/30',   glow: 'shadow-amber-500/10' },
  pink:    { bg: 'from-pink-500/10 to-rose-500/10',     text: 'text-pink-300',    border: 'border-pink-500/30',    glow: 'shadow-pink-500/10' },
  emerald: { bg: 'from-emerald-500/10 to-green-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/10' },
};

export default function HomeSection({ title, titleEn, emoji, href, items, accent = 'cyan', loading, linkMode }: SectionProps) {
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
            {items.map((it, i) => {
              // 2026-08-09: noPoster (网盘资源) 走 source 卡片, 有 poster 走老海报卡片
              //   - 其他 section (upcoming/basic/themes) poster 不为 null, 走老逻辑, 不影响
              const isSourceCard = !!it.noPoster;
              const sm = isSourceCard ? getSourceMeta(it.source) : null;
              return (
                <motion.div
                  key={it.id + '-' + i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.3 }}
                  className="flex-shrink-0 w-[140px] sm:w-[160px] cursor-pointer group/card"
                  onClick={() => {
                    // 2026-08-09: linkMode (网盘资源) 优先开网盘直链, 不跳详情页
                    if (linkMode && it.link) {
                      try {
                        window.open(it.link, '_blank', 'noopener,noreferrer');
                      } catch {}
                      return;
                    }
                    // 2026-08-04 P9.3: VIP 资源跳 /vip/[id] 业务页 (playerla + m3u8 视频)
                    //   - 用户原话: "我是看视频的专区你给我弄成什么了"
                    //   - /vip/[id] 才是真正放 playerla iframe / m3u8 的视频页
                    //   - 通用 /tmdb/[type]/[id] 是下载链接列表, 不能播
                    // 判定: accessLevel==='vip' 或 importChannel 是 zezhe 系列 → VIP 专区资源
                    const isVipResource = it.accessLevel === 'vip' || it.importChannel === 'zezhe' || it.importChannel === 'zezemom_excel';
                    if (isVipResource && it.id) {
                      location.href = `/vip/${it.id}`;
                    } else if (it.tmdbId && it.tmdbType) {
                      location.href = `/tmdb/${it.tmdbType}/${it.tmdbId}`;
                    } else {
                      location.href = `/titles`;
                    }
                  }}
                >
                  {isSourceCard && sm ? (
                    // ============ 网盘资源卡片 (无海报) ============
                    <div className={`relative aspect-[2/3] rounded-xl overflow-hidden bg-gradient-to-br ${sm.gradient} mb-1.5 ring-1 ring-white/10 group-hover/card:ring-violet-400/40 transition`}>
                      {/* 大 emoji 占位 */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
                        <div className="text-5xl sm:text-6xl drop-shadow-lg group-hover/card:scale-110 transition duration-500">{sm.emoji}</div>
                        <div className={`mt-2 px-1.5 py-0.5 rounded text-[9px] bg-black/40 ${sm.text} font-medium uppercase tracking-wide`}>
                          {it.sourceDisplay || it.source}
                        </div>
                      </div>
                      {/* VIP 锁 / code 解锁 / 短剧 角标 */}
                      <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 items-end">
                        {it.isShortDrama && (
                          // 2026-08-14: 短剧打标 (noPoster 卡片也支持, 短剧多在网盘资源里)
                          <span className="px-1.5 py-0.5 rounded bg-pink-500/85 text-[9px] text-white font-medium shadow-sm shadow-pink-500/30">
                            🎬 短剧
                          </span>
                        )}
                        {it.accessLevel === 'vip' && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/80 text-[9px] text-white font-medium">
                            🔒 VIP
                          </span>
                        )}
                        {it.payType === 'code' && it.lumenCost != null && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-500/80 text-[9px] text-white font-medium">
                            💰 {it.lumenCost}
                          </span>
                        )}
                      </div>
                      {/* 大小 右下角 */}
                      {it.size && (
                        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white/90 backdrop-blur font-medium">
                          {it.size}
                        </div>
                      )}
                    </div>
                  ) : (
                    // ============ 原海报卡片 (TMDB 资源) ============
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-1.5 ring-1 ring-white/5 group-hover/card:ring-violet-400/40 transition">
                      <img
                        src={it.posterUrl || TMDB_FALLBACK}
                        alt={it.title}
                        className="w-full h-full object-cover group-hover/card:scale-105 transition duration-500"
                        onError={(e: any) => { e.target.src = TMDB_FALLBACK; }}
                        loading="lazy"
                        decoding="async"
                      />
                      {/* 类型/年份标签 */}
                      <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 items-start">
                        {it.tmdbType && (
                          <span className="px-1.5 py-0.5 rounded bg-black/70 text-[9px] text-white/90 backdrop-blur">
                            {it.tmdbType === 'movie' ? '🎬' : '📺'}
                          </span>
                        )}
                        {it.isShortDrama && (
                          // 2026-08-14: 短剧打标 - 粉色 chip, 跟泽泽妈粉紫区分 (单色纯粉)
                          //   位置: top-left, 跟其他角标并列; 不影响分类, 只是打标
                          <span className="px-1.5 py-0.5 rounded bg-pink-500/85 text-[9px] text-white font-medium shadow-sm shadow-pink-500/30">
                            🎬 短剧
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
                  )}
                  {/* 标题 (两种卡片共用) */}
                  <h3 className="text-xs font-medium text-white/90 line-clamp-1 group-hover/card:text-violet-300 transition">
                    {it.title}
                  </h3>
                  {/* 年份 + 源 */}
                  <div className="flex items-center gap-1 mt-0.5 text-[10px] text-white/40">
                    {isSourceCard ? (
                      <>
                        {it.category && <span className="line-clamp-1">{it.category}</span>}
                      </>
                    ) : (
                      <>
                        {it.releaseDate && <span>{it.releaseDate.slice(0, 4)}</span>}
                        {it.source && <span className="uppercase">· {it.source}</span>}
                      </>
                    )}
                  </div>
                </motion.div>
              );
            })}
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
