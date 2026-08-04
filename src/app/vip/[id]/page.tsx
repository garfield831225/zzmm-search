'use client';
// 2026-08-04 P9.3: linkMode 适配 (player / download / none)
//   - player: 走 PlayerStage 视频播放器 (playerla iframe + m3u8 真链)
//   - download: 走 DownloadPanel 下载按钮列表 (网盘分享, 不能 iframe 嵌)
//   - none: 显示"暂无播放链接"提示

import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';

// 2026-07-24: hls.js 全局类型 (CDN 加载, 没 npm 包)
declare global {
  interface Window {
    Hls?: any;
  }
}

interface VipLink {
  id: number;
  source: string;
  status: string;
  season: number | null;
  episode: number | null;
  episodeTitle: string | null;
  playUrl: string;
  lastOkAt: string | null;
  password?: string | null;  // 2026-08-04 P9.3: download 模式显示提取码
  mode?: 'player' | 'download';  // 2026-08-04 P9.3: link 来源模式
  m3u8Urls?: { source: string; url: string; expires_at: string | null }[] | null;  // 2026-07-24 备份真链
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
  // 2026-08-04 P9.3: linkMode 决定是放视频还是显示下载按钮
  //   - 'player' | 'download' | 'none'
  const [linkMode, setLinkMode] = useState<'player' | 'download' | 'none'>('none');
  // 2026-07-24: 当前选中的集数 / 视频 URL (inline iframe 播放)
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);

  // 默认选第一个 link
  const selectedLink = useMemo(
    () => links.find((l) => l.id === selectedLinkId) || links[0] || null,
    [links, selectedLinkId]
  );

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
        setLinkMode(data.linkMode || (data.links?.length > 0 ? 'player' : 'none'));
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

        {/* 2026-08-04 P9.3: 视频区按 linkMode 分支
            - 'player' 模式: 多源播放器 (m3u8 优先 + playerla iframe fallback)
            - 'download' 模式: 下载按钮列表 (网盘分享, 不能 iframe 嵌)
            - 'none' 模式: 暂无播放链接, 提示用户 */}
        {linkMode === 'player' && selectedLink && (
          <div className="mt-8 rounded-2xl overflow-hidden bg-black ring-1 ring-white/10 shadow-2xl">
            <PlayerStage link={selectedLink} title={resource.title} />
          </div>
        )}

        {linkMode === 'download' && (
          <DownloadPanel links={links} title={resource.title} />
        )}

        {linkMode === 'none' && (
          <div className="mt-8 px-6 py-10 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center">
            <div className="text-5xl mb-3 opacity-50">🎬</div>
            <h3 className="text-base font-bold text-white/80 mb-2">暂无播放链接</h3>
            <p className="text-sm text-white/40 max-w-md mx-auto leading-relaxed">
              该资源还未匹配到视频源<br />
              同步脚本在跑, 请稍候再试
            </p>
            <a href="/vip" className="inline-block mt-4 text-xs text-indigo-300 hover:underline">← 返回列表</a>
          </div>
        )}

        {/* 播放列表区 */}
        <div className="mt-8">
          {resource.mediaType === 'movie' ? (
            <div>
              <h2 className="text-xl font-extrabold mb-4">播放</h2>
              {!hasMovie ? (
                <div className="px-6 py-8 rounded-2xl bg-white/5 text-white/40 text-center">
                  暂无播放链接, 等待匹配脚本
                </div>
              ) : null}
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
                        {eps.map((ep) => {
                          const active = (selectedLink?.id === ep.id);
                          return (
                            <button
                              key={ep.id}
                              type="button"
                              onClick={() => setSelectedLinkId(ep.id)}
                              className={`px-3 py-2 rounded-lg text-center text-sm font-bold transition-all ${
                                active
                                  ? 'bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-lg ring-2 ring-indigo-300'
                                  : 'bg-gradient-to-r from-indigo-500/20 to-fuchsia-500/20 hover:from-indigo-500/40 hover:to-fuchsia-500/40 border border-indigo-400/30 hover:border-indigo-400/60 text-white'
                              }`}
                              title={ep.episodeTitle || `第 ${ep.episode} 集`}
                            >
                              {ep.episode}
                            </button>
                          );
                        })}
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

// 2026-07-24: 多源播放器 (m3u8 真链 hls.js + playerla iframe fallback)
// 用户担心第三方源被锁, 所以 m3u8 真链优先 (本地备份)
// playerla iframe 作为 fallback (源被锁时仍可看 playerla 自己的嵌入)
function PlayerStage({ link, title }: { link: VipLink; title: string }) {
  const m3u8s = link.m3u8Urls || [];
  const hasM3u8 = m3u8s.length > 0;
  // 优先 m3u8 源, 没 m3u8 才用 playerla iframe
  const [mode, setMode] = useState<'m3u8' | 'iframe'>(hasM3u8 ? 'm3u8' : 'iframe');
  const [sourceIdx, setSourceIdx] = useState(0);
  const [errored, setErrored] = useState(false);

  // 选中的 m3u8 (跳过已过期的)
  const validM3u8s = m3u8s.filter((m) => {
    if (!m.expires_at) return true;
    return new Date(m.expires_at).getTime() > Date.now();
  });
  const currentM3u8 = validM3u8s[sourceIdx] || validM3u8s[0];
  const allM3u8Failed = errored && sourceIdx >= validM3u8s.length - 1;

  return (
    <>
      <div className="relative" style={{ paddingBottom: '56.25%' }}>
        {mode === 'm3u8' && currentM3u8 ? (
          <M3u8Player url={currentM3u8.url} onError={() => {
            if (sourceIdx < validM3u8s.length - 1) {
              setSourceIdx(sourceIdx + 1);
            } else {
              setErrored(true);
            }
          }} />
        ) : (
          <iframe
            key={link.id}
            src={link.playUrl}
            className="absolute inset-0 w-full h-full"
            frameBorder={0}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            title={`${title} 播放`}
          />
        )}
        {allM3u8Failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white">
            <p className="text-lg font-bold mb-3">m3u8 源全部失败</p>
            <button onClick={() => { setSourceIdx(0); setErrored(false); }} className="px-4 py-2 bg-indigo-500 rounded-lg mr-2">重试</button>
            <button onClick={() => setMode('iframe')} className="px-4 py-2 bg-white/10 rounded-lg mt-2">切到 playerla 嵌入</button>
          </div>
        )}
      </div>
      <div className="px-4 py-2 flex items-center justify-between text-xs text-white/40 bg-black/60 gap-3 flex-wrap">
        <div>
          {link.source && <span className="mr-2">· {link.source}</span>}
          {mode === 'm3u8' && currentM3u8 && (
            <span className="text-emerald-400">▶ m3u8 ({currentM3u8.source})</span>
          )}
          {mode === 'iframe' && <span className="text-amber-400">▶ playerla 嵌入</span>}
        </div>
        <div className="flex items-center gap-2">
          {hasM3u8 && validM3u8s.length > 1 && (
            <select value={sourceIdx} onChange={(e) => { setSourceIdx(parseInt(e.target.value, 10)); setErrored(false); }} className="bg-white/10 rounded px-2 py-1 text-white text-xs">
              {validM3u8s.map((m, i) => <option key={i} value={i}>{m.source} {m.expires_at ? `(${new Date(m.expires_at).toLocaleTimeString()})` : ''}</option>)}
            </select>
          )}
          {hasM3u8 && (
            <button onClick={() => setMode(mode === 'm3u8' ? 'iframe' : 'm3u8')} className="px-2 py-1 bg-white/10 rounded hover:bg-white/20">
              切 {mode === 'm3u8' ? 'playerla' : 'm3u8'}
            </button>
          )}
          <a href={link.playUrl} target="_blank" rel="noopener noreferrer" className="hover:text-white/80">新窗口 ↗</a>
        </div>
      </div>
    </>
  );
}

// 2026-07-24: hls.js m3u8 播放器
function M3u8Player({ url, onError }: { url: string; onError: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: any = null;
    let cancelled = false;

    // Safari 原生支持 HLS
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
      return;
    }

    // Chrome / Firefox: 用 hls.js (CDN)
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
    script.async = true;
    script.onload = () => {
      if (cancelled) return;
      // @ts-ignore
      if (window.Hls && window.Hls.isSupported()) {
        // @ts-ignore
        hls = new window.Hls({ debug: false });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.ERROR, (_e: any, data: any) => {
          if (data.fatal) {
            onError();
            try { hls?.destroy(); } catch {}
          }
        });
        video.play().catch(() => {});
      } else {
        onError();
      }
    };
    script.onerror = () => onError();
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      try { hls?.destroy(); } catch {}
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
    };
  }, [url, onError]);

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 w-full h-full bg-black"
      controls
      playsInline
      autoPlay
    />
  );
}

// 2026-08-04 P9.3: download 模式组件
//   - 资源只有网盘分享 (aliyun/baidu/quark) 没有 playerla iframe 时走这里
//   - 显示下载按钮, 让用户点开对应网盘
//   - 不能 iframe 嵌网盘, 会崩
function DownloadPanel({ links, title }: { links: VipLink[]; title: string }) {
  const [copied, setCopied] = useState<number | null>(null);

  const handleCopy = async (text: string, id: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  const sourceIcon = (s: string) => {
    if (s?.includes('aliyun') || s?.includes('alipan')) return '☁️ 阿里云盘';
    if (s?.includes('baidu')) return '📦 百度网盘';
    if (s?.includes('quark')) return '⚡ 夸克网盘';
    if (s?.includes('115')) return '💾 115 网盘';
    if (s?.includes('magnet')) return '🧲 磁力链接';
    if (s?.includes('ed2k')) return '🔗 ed2k 链接';
    return s || '下载链接';
  };

  return (
    <div className="mt-8 rounded-2xl bg-gradient-to-br from-indigo-500/[0.08] via-fuchsia-500/[0.06] to-amber-500/[0.05] border border-white/[0.08] p-6 sm:p-8">
      <div className="flex items-center gap-3 mb-5">
        <div className="text-2xl">📥</div>
        <div>
          <h2 className="text-lg font-bold text-white">下载链接</h2>
          <p className="text-xs text-white/40 mt-0.5">该资源暂未匹配到在线视频源, 请使用网盘下载</p>
        </div>
      </div>

      <div className="space-y-3">
        {links.map((l) => {
          const isDownloadable = l.playUrl && (l.playUrl.startsWith('http') || l.playUrl.startsWith('magnet:') || l.playUrl.startsWith('ed2k:'));
          return (
            <div key={l.id} className="flex items-center gap-3 p-3 sm:p-4 rounded-xl bg-black/30 hover:bg-black/50 transition border border-white/[0.04]">
              <div className="text-sm font-semibold text-white/80 min-w-[100px]">
                {sourceIcon(l.source)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white/50 truncate font-mono">
                  {l.playUrl || '(无链接)'}
                </div>
                {l.password && (
                  <div className="text-[11px] text-amber-300/80 mt-0.5">提取码: {l.password}</div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {l.playUrl && (
                  <button
                    onClick={() => handleCopy(l.playUrl, l.id)}
                    className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-lg text-white/70 transition"
                  >
                    {copied === l.id ? '✓ 已复制' : '复制'}
                  </button>
                )}
                {isDownloadable && (
                  <a
                    href={l.playUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs bg-gradient-to-r from-indigo-500 to-fuchsia-500 hover:opacity-90 rounded-lg text-white font-medium transition"
                  >
                    打开
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
