'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Star, Copy, ExternalLink, Calendar, Globe, Film, Tv, Users, Lock, Play } from 'lucide-react';
import { SOURCE_DICT, getSourceInfo } from '@/lib/sources';

const TMDB_IMG = 'https://image.tmdb.org/t/p';

interface ResourceItem {
  id: number;
  name: string;
  link: string;
  link_code: string | null;
  source: string;
  size: string | null;
  lumen_cost: number;
  access_tier: string;
  import_channel: string | null;
  doc_sheet: string | null;
  created_at: string;
}

interface TmdbResourcesResponse {
  tmdb_id: string;
  type: string;
  user_group: string;
  total: number;
  by_source: Array<{ source: string; count: number; items: ResourceItem[] }>;
}

interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

interface CrewMember {
  id: number;
  name: string;
  job: string;
  profile_path: string | null;
}

interface TmdbCredits {
  source: 'cache' | 'fresh';
  cast: CastMember[];
  crew: CrewMember[];
  backdrop_path: string | null;
  overview: string | null;
  tagline: string | null;
  genres: string[];
  title: string | null;
  original_title: string | null;
  vote_average: string | null;
  vote_count: string | null;
}

export default function TmdbDetailPage() {
  const params = useParams();
  const type = params.type as string; // movie | tv
  const tmdbId = params.id as string;

  const [resources, setResources] = useState<TmdbResourcesResponse | null>(null);
  const [credits, setCredits] = useState<TmdbCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setImgError(false);
    Promise.all([
      fetch(`/api/tmdb-resources/${type}/${tmdbId}`).then(r => r.json()).catch(() => null),
      fetch(`/api/tmdb-credits/${type}/${tmdbId}`).then(r => r.json()).catch(() => null),
    ]).then(([res, cred]) => {
      setResources(res);
      setCredits(cred);
      setLoading(false);
    });
  }, [type, tmdbId]);

  const copyLink = useCallback(async (id: number, link: string, code: string | null) => {
    const text = code ? `${link}\n提取码: ${code}` : link;
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  // 1. 海报 + 标题从 credits 取（无则 fallback）
  // 2026-08-05: 链式 optional chaining 必加每一段 ?. — resources=null 时 by_source[0] 抛 TypeError
  const title = credits?.title
    || resources?.by_source?.[0]?.items?.[0]?.name?.replace(/\s*\(\d{4}\)\s*/g, '').slice(0, 30)
    || '未知资源';
  const poster = credits?.genres ? null : null; // poster 从另一个 API 拿 (因为 credits 不返 poster_path 全 URL)
  // poster_path 是 /xxx.jpg，需要拼 base url
  const backdrop = credits?.backdrop_path;
  const overview = credits?.overview;
  const genres = credits?.genres || [];
  const voteAverage = credits?.vote_average ? parseFloat(credits.vote_average) : 0;
  const voteCount = credits?.vote_count ? parseInt(credits.vote_count) : 0;
  const cast = credits?.cast || [];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* 顶部 backdrop */}
      {backdrop && (
        <div className="relative h-[40vh] w-full overflow-hidden">
          <img src={backdrop} alt="" className="w-full h-full object-cover opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/60 to-black" />
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6 relative z-10">
        {/* 返回按钮 */}
        <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-4 text-sm">
          <ArrowLeft size={16} /> 返回
        </Link>

        {/* 上半部: TMDB 数据 (海报/标题/简介/演员) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* 海报占位 */}
          <div className="md:col-span-1">
            <div className="aspect-[2/3] bg-gradient-to-br from-purple-900/30 to-blue-900/30 rounded-lg flex items-center justify-center border border-gray-800">
              {type === 'movie' ? <Film size={64} className="text-gray-600" /> : <Tv size={64} className="text-gray-600" />}
              <div className="absolute mt-32 text-xs text-gray-500">TMDB #{tmdbId}</div>
            </div>
          </div>

          {/* 标题 + 简介 */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              {type === 'movie' ? <Film size={20} className="text-purple-400" /> : <Tv size={20} className="text-blue-400" />}
              <span className="text-xs text-gray-400 uppercase">{type === 'movie' ? '电影' : '电视剧'}</span>
              {voteAverage > 0 && (
                <span className="flex items-center gap-1 text-yellow-400 text-sm">
                  <Star size={14} fill="currentColor" /> {voteAverage.toFixed(1)}
                  {voteCount > 0 && <span className="text-gray-500 text-xs">({voteCount})</span>}
                </span>
              )}
            </div>

            <h1 className="text-3xl font-bold mb-2">{title}</h1>

            {credits?.original_title && credits.original_title !== title && (
              <div className="text-gray-400 text-sm mb-3">{credits.original_title}</div>
            )}

            {genres.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {genres.map((g, i) => (
                  <span key={i} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-gray-300">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {overview ? (
              <p className="text-gray-300 text-sm leading-relaxed">{overview}</p>
            ) : (
              <p className="text-gray-500 text-sm italic">暂无简介</p>
            )}
          </div>
        </div>

        {/* 演员表 */}
        {cast.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Users size={18} /> 演员表 <span className="text-gray-500 text-xs">({cast.length})</span>
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-10 gap-3">
              {cast.map((c) => (
                <div key={c.id} className="text-center">
                  <div className="aspect-[2/3] bg-gray-900 rounded overflow-hidden mb-1">
                    {c.profile_path ? (
                      <img src={c.profile_path} alt={c.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-700 text-2xl">👤</div>
                    )}
                  </div>
                  <div className="text-xs text-white truncate">{c.name}</div>
                  <div className="text-[10px] text-gray-500 truncate">{c.character}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 下半部: xx_resources 链接 (按 source 分组) */}
        <div className="border-t border-gray-800 pt-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Play size={18} /> 资源链接
            {resources && <span className="text-gray-500 text-xs">({resources.total} 条)</span>}
          </h2>

          {!resources || resources.total === 0 ? (
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 text-center text-gray-500">
              <Lock size={32} className="mx-auto mb-2 opacity-50" />
              <div>暂无资源</div>
              <div className="text-xs mt-2">
                {resources?.user_group === 'user' && '激活会员后可查看完整资源'}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {resources.by_source.map((group) => {
                const info = getSourceInfo(group.source);
                return (
                  <div key={group.source} className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
                    {/* 网盘 section header */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 border-b border-gray-800"
                      style={{ borderLeftWidth: 4, borderLeftColor: info.color }}
                    >
                      <span className="text-2xl">{info.icon}</span>
                      <span className="font-medium" style={{ color: info.color }}>{info.display_name}</span>
                      <span className="text-xs text-gray-500 ml-auto">{group.count} 条</span>
                    </div>

                    {/* 链接列表 */}
                    <div className="divide-y divide-gray-800/50">
                      {group.items.map((item) => (
                        <div key={item.id} className="px-4 py-3 hover:bg-white/5 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-white truncate" title={item.name}>
                                {item.name}
                              </div>
                              <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-gray-500">
                                {item.size && <span>📦 {item.size}</span>}
                                {item.doc_sheet && <span>📄 {item.doc_sheet}</span>}
                                {item.import_channel && <span>📥 {item.import_channel}</span>}
                                {item.lumen_cost && item.lumen_cost > 0 && (
                                  <span className="text-yellow-400">💎 {item.lumen_cost}</span>
                                )}
                                {item.link_code && <span>🔑 {item.link_code}</span>}
                              </div>
                            </div>

                            <button
                              onClick={() => copyLink(item.id, item.link, item.link_code)}
                              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-xs flex items-center gap-1 transition-colors"
                              title="复制链接+提取码"
                            >
                              <Copy size={12} />
                              {copiedId === item.id ? '已复制' : '复制'}
                            </button>

                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-xs flex items-center gap-1 transition-colors"
                            >
                              <ExternalLink size={12} /> 打开
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}