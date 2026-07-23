'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface VipLink {
  id: number;
  source: string;
  status: string;
  season: number | null;
  episode: number | null;
  episodeTitle: string | null;
  playUrl: string;
  lastOkAt: string | null;
}

interface VipResource {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle: string | null;
  originalLanguage: string | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  voteAverage: number | null;
  voteCount: number;
  releaseDate: string | null;
  popularity: number;
  genreIds: number[];
  seasonCount: number | null;
  episodeCount: number | null;
  status: string | null;
  runtime: number | null;
}

const TMDB_IMG = 'https://image.tmdb.org/t/p';

// 流行类型 ID → 中文名 (只列常见的)
const GENRE_MAP: Record<number, string> = {
  28: '动作', 12: '冒险', 16: '动画', 35: '喜剧', 80: '犯罪',
  99: '纪录', 18: '剧情', 10751: '家庭', 14: '奇幻', 36: '历史',
  27: '恐怖', 10402: '音乐', 9648: '悬疑', 10749: '爱情', 878: '科幻',
  10770: '电视', 53: '惊悚', 10752: '战争', 37: '西部',
  10759: '动作冒险', 10762: '儿童', 10763: '新闻', 10764: '真人秀',
  10765: '科幻奇幻', 10766: '剧情肥皂剧', 10767: '脱口秀', 10768: '战争政治',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return d.slice(0, 10);
}

export default function VipDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [resource, setResource] = useState<VipResource | null>(null);
  const [links, setLinks] = useState<VipLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const resp = await fetch(`/api/vip/${id}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          setError(data.error || `HTTP ${resp.status}`);
          if (resp.status === 403) setTimeout(() => router.push('/'), 1200);
          if (resp.status === 404) setTimeout(() => router.push('/vip'), 1200);
          setLoading(false);
          return;
        }
        const data = await resp.json();
        setResource(data.resource);
        setLinks(data.links || []);
      } catch (e: any) {
        if (!cancelled) setError(e.message || '网络错误');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white/40">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-white/40 gap-3">
        <div className="text-rose-300">{error}</div>
        <a href="/vip" className="text-sm text-indigo-300 hover:underline">← 返回列表</a>
      </div>
    );
  }

  if (!resource) return null;

  // 按季分组链接
  const linksBySeason = new Map<number, VipLink[]>();
  for (const l of links) {
    if (l.season == null) continue;
    if (!linksBySeason.has(l.season)) linksBySeason.set(l.season, []);
    linksBySeason.get(l.season)!.push(l);
  }
  // 排序: 每季内按 episode
  linksBySeason.forEach((arr) => arr.sort((a, b) => (a.episode || 0) - (b.episode || 0)));

  const hasMovie = resource.mediaType === 'movie' && links.length > 0;
  const hasTv = resource.mediaType === 'tv' && linksBySeason.size > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      {/* 顶部背景 */}
      {resource.backdropUrl && (
        <div className="relative h-72 sm:h-96 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resource.backdropUrl.replace('/w1280', '/original')}
            alt={resource.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent" />
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-40 relative z-10 pb-16">
        {/* 标题区 */}
        <div className="flex flex-col sm:flex-row gap-6">
          {/* 海报 */}
          <div className="flex-shrink-0 w-40 sm:w-56">
            {resource.posterUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={resource.posterUrl}
                alt={resource.title}
                className="w-full rounded-2xl shadow-2xl ring-1 ring-white/10"
              />
            ) : (
              <div className="w-full aspect-[2/3] rounded-2xl bg-white/5 flex items-center justify-center text-6xl text-white/20">
                {resource.mediaType === 'movie' ? '🎥' : '📺'}
              </div>
            )}
          </div>

          {/* 标题 + 简介 */}
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-2">
              {resource.title}
            </h1>
            {resource.originalTitle && resource.originalTitle !== resource.title && (
              <p className="text-base text-white/40 mb-3">{resource.originalTitle}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
              {resource.releaseDate && (
                <span className="px-2 py-1 rounded-md bg-white/5 text-white/60">{fmtDate(resource.releaseDate)}</span>
              )}
              {resource.voteAverage && resource.voteAverage > 0 && (
                <span className="px-2 py-1 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  ★ {resource.voteAverage.toFixed(1)} ({resource.voteCount} 评)
                </span>
              )}
              {resource.runtime && (
                <span className="px-2 py-1 rounded-md bg-white/5 text-white/60">{resource.runtime} 分钟</span>
              )}
              {resource.mediaType === 'tv' && resource.seasonCount && (
                <span className="px-2 py-1 rounded-md bg-white/5 text-white/60">{resource.seasonCount} 季 · {resource.episodeCount || '?'} 集</span>
              )}
              {resource.status && (
                <span className={`px-2 py-1 rounded-md text-xs ${
                  resource.status === 'Returning Series' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' :
                  resource.status === 'Ended' ? 'bg-white/5 text-white/40' :
                  'bg-white/5 text-white/60'
                }`}>
                  {resource.status === 'Returning Series' ? '连载中' : resource.status === 'Ended' ? '已完结' : resource.status}
                </span>
              )}
              {resource.genreIds.slice(0, 3).map((gid) => GENRE_MAP[gid]).filter(Boolean).map((g) => (
                <span key={g} className="px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                  {g}
                </span>
              ))}
            </div>

            {resource.overview && (
              <p className="text-sm text-white/60 leading-relaxed line-clamp-4 mb-4">
                {resource.overview}
              </p>
            )}

            {/* 播放链接统计 */}
            <div className="flex items-center gap-3 text-xs">
              <span className={`px-3 py-1.5 rounded-lg font-bold ${
                links.length > 0
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'
                  : 'bg-white/5 text-white/40'
              }`}>
                {links.length > 0 ? `▶ ${links.length} 集可播放` : '暂无播放链接'}
              </span>
              <span className="text-white/30">数据源: xingfan.cc</span>
            </div>
          </div>
        </div>

        {/* 播放列表区 */}
        <div className="mt-12">
          {resource.mediaType === 'movie' ? (
            <div>
              <h2 className="text-xl font-extrabold mb-4">播放</h2>
              {hasMovie ? (
                <a
                  href={links[0].playUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-6 py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 hover:from-indigo-400 hover:to-fuchsia-400 text-center font-extrabold text-white shadow-lg"
                >
                  ▶ 在新窗口播放
                </a>
              ) : (
                <div className="px-6 py-4 rounded-2xl bg-white/5 text-white/40 text-center">
                  暂无播放链接, 等待匹配脚本
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-extrabold mb-4">剧集</h2>
              {linksBySeason.size === 0 ? (
                <div className="px-6 py-8 rounded-2xl bg-white/5 text-white/40 text-center">
                  暂无播放链接, 等待匹配脚本
                </div>
              ) : (
                <div className="space-y-6">
                  {Array.from(linksBySeason.entries()).sort((a, b) => a[0] - b[0]).map(([season, eps]) => (
                    <div key={season}>
                      <h3 className="text-sm font-bold text-white/60 mb-2">第 {season} 季 · {eps.length} 集</h3>
                      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10 gap-2">
                        {eps.map((ep) => (
                          <a
                            key={ep.id}
                            href={ep.playUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-500/20 to-fuchsia-500/20 hover:from-indigo-500/40 hover:to-fuchsia-500/40 border border-indigo-400/30 hover:border-indigo-400/60 text-center text-sm font-bold text-white transition-all"
                            title={ep.episodeTitle || `第 ${ep.episode} 集`}
                          >
                            {ep.episode}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 返回 */}
        <div className="mt-12 text-center">
          <a href="/vip" className="text-sm text-white/40 hover:text-white/70">← 返回 VIP 列表</a>
        </div>
      </div>
    </div>
  );
}
