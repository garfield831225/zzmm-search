'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Calendar, Tv, Loader2, AlertCircle, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarItem {
  id: string;
  source: string;
  tmdbId: string | null;
  title: string;
  airDate: string;
  airTime: string | null;
  episode: { season: number; number: number; title: string | null } | null;
  overview: string | null;
  poster: string | null;
  country?: string;
  localResourceCount: number;
  localSources: string[];
}

// 2026-08-14: 追剧日历区块
// - 显示未来 30 天的剧集日历 (SIMKL + TVMaze 合并)
// - 按日期分桶
// - 卡片: 标题 + SxxExx + 集标题 + 本地资源数
// - 日期切换 (今天 / 14 天 / 30 天)
type Region = 'all' | 'eu' | 'asia';

const REGIONS: { id: Region; name: string; emoji: string }[] = [
  { id: 'all', name: '全部', emoji: '🌐' },
  { id: 'eu', name: '欧美', emoji: '🌎' },
  { id: 'asia', name: '亚洲', emoji: '🌏' },
];

export default function CalendarSection() {
  const [days, setDays] = useState<number>(30);
  const [region, setRegion] = useState<Region>('all');
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  });
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [byDate, setByDate] = useState<Record<string, CalendarItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/calendar?start=${startDate}&days=${days}&type=tv&region=${region}`;
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data?.error?.message || `HTTP ${r.status}`);
        }
        const data = await r.json();
        if (cancelled) return;
        setItems(data.items || []);
        setByDate(data.byDate || {});
        setCachedAt(data.cachedAt || null);
      } catch (e: any) {
        if (!cancelled) setError(e.message || '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [startDate, days, region]);

  // 滚动到今天的日期
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // 排序日期
  const sortedDates = useMemo(() => Object.keys(byDate).sort(), [byDate]);

  return (
    <div className="space-y-4">
      {/* 控件栏 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => {
              const d = new Date(startDate);
              d.setUTCDate(d.getUTCDate() - 7);
              setStartDate(d.toISOString().slice(0, 10));
            }}
            className="p-1.5 rounded-lg bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] border border-white/[0.06] transition"
            title="前一周"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => {
              const d = new Date();
              setStartDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
            }}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/70 hover:text-white hover:bg-white/[0.08] border border-white/[0.06] transition text-xs"
          >
            回到今天
          </button>
          <button
            onClick={() => {
              const d = new Date(startDate);
              d.setUTCDate(d.getUTCDate() + 7);
              setStartDate(d.toISOString().slice(0, 10));
            }}
            className="p-1.5 rounded-lg bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] border border-white/[0.06] transition"
            title="后一周"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="flex-1 min-w-0 text-xs text-white/50 truncate">
          {startDate} 起 {days} 天 · 共 {items.length} 集
        </div>

        {/* 2026-08-14: 区域切换 (全部/欧美/亚洲) */}
        <div className="flex gap-1 shrink-0">
          {REGIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => setRegion(r.id)}
              className={`px-2.5 py-1 rounded-lg text-xs transition flex items-center gap-1 ${
                region === r.id ? 'bg-fuchsia-500/30 text-white border border-fuchsia-400/50' : 'bg-white/[0.03] text-white/50 hover:text-white/80 border border-white/[0.05]'
              }`}
            >
              <span>{r.emoji}</span>
              <span>{r.name}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-1 shrink-0">
          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-lg text-xs transition ${
                days === d ? 'bg-violet-500/30 text-white border border-violet-400/50' : 'bg-white/[0.03] text-white/50 hover:text-white/80 border border-white/[0.05]'
              }`}
            >
              {d}天
            </button>
          ))}
        </div>
      </div>

      {cachedAt && !loading && (
        <div className="text-[10px] text-white/30 text-right">
          缓存于 {new Date(cachedAt).toLocaleString('zh-CN', { hour12: false })}
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-300 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-red-200">
            <div className="font-medium">加载失败</div>
            <div className="text-xs text-red-200/70 mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 gap-2 text-white/50">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">加载中…</span>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="text-center py-12 text-white/40 text-sm">
          <Calendar size={32} className="mx-auto mb-2 opacity-50" />
          暂无追剧日程
        </div>
      )}

      {!loading && !error && sortedDates.length > 0 && (
        <div className="space-y-4">
          {sortedDates.map((date) => {
            const dayItems = byDate[date];
            const isToday = date === todayStr;
            const dateObj = new Date(date + 'T00:00:00');
            const weekday = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];
            return (
              <section key={date}>
                <div className={`flex items-center gap-2 mb-2 px-1 ${isToday ? 'text-violet-300' : 'text-white/60'}`}>
                  {isToday && <span className="px-1.5 py-0.5 bg-violet-500/30 border border-violet-400/50 rounded text-[10px] font-bold">今天</span>}
                  <h3 className="text-sm font-bold">
                    {dateObj.getMonth() + 1}月{dateObj.getDate()}日
                  </h3>
                  <span className="text-xs text-white/40">周{weekday}</span>
                  <span className="text-xs text-white/30 ml-auto">{dayItems.length} 集</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {dayItems.map((it) => (
                    <div
                      key={it.id}
                      className="flex gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-violet-400/30 hover:bg-white/[0.04] transition"
                    >
                      {/* 2026-08-14: 加海报 (TVMaze image.medium, 210x295) - 改 80x120 大图 */}
                      <div className="w-20 h-[120px] rounded-md overflow-hidden bg-white/[0.06] flex-shrink-0">
                        {it.poster ? (
                          <img
                            src={it.poster}
                            alt={it.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/20 text-xs">无图</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {it.tmdbId ? (
                          <Link href={`/tmdb/tv/${it.tmdbId}`} className="block">
                            <div className="text-sm font-medium text-white/90 line-clamp-1 hover:text-violet-300 transition">
                              {it.title}
                            </div>
                          </Link>
                        ) : (
                          <div className="text-sm font-medium text-white/90 line-clamp-1">
                            {it.title}
                          </div>
                        )}
                        <div className="text-[11px] text-white/50 mt-0.5 flex items-center gap-1.5">
                          {it.episode && (
                            <span className="text-cyan-300 font-mono">
                              S{String(it.episode.season).padStart(2, '0')}E{String(it.episode.number).padStart(2, '0')}
                            </span>
                          )}
                          {it.episode?.title && (
                            <span className="truncate">· {it.episode.title}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          {it.localResourceCount > 0 ? (
                            <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-medium rounded flex items-center gap-1">
                              <ExternalLink size={9} />{it.localResourceCount} 网盘
                            </span>
                          ) : (
                            <span className="text-[10px] text-white/30">无本地</span>
                          )}
                          {it.source && (
                            <span className="text-[10px] text-white/25">via {it.source}</span>
                          )}
                          {it.country && (
                            <span className={`text-[10px] px-1 rounded font-mono ${
                              ['CN', 'JP', 'KR', 'TW', 'HK'].includes(it.country)
                                ? 'bg-amber-500/15 text-amber-300/80'
                                : 'bg-blue-500/15 text-blue-300/80'
                            }`}>{it.country}</span>
                          )}
                          {it.airTime && (
                            <span className="text-[10px] text-white/30 ml-auto">{it.airTime}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
