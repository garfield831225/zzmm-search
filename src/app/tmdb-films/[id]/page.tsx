'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft, Star, Lock, Copy, ExternalLink, Calendar, Globe, Tag, Film, Tv, Heart, X, Check } from 'lucide-react';

const TMDB_IMG = 'https://image.tmdb.org/t/p';

interface LinkItem {
  id: number;
  name: string;
  link: string;
  link_code: string;
  source: string;
  category: string;
  size: string;
  type: string;
  tags: string[];
  view_count: number;
  pay_type: string;
  code_price: number;
  access_level: string;
  import_channel: string;
  canAccess: boolean;
  lockReason: string | null;
}

const SOURCE_META: Record<string, { label: string; icon: string; color: string }> = {
  '115':    { label: '115网盘',   icon: '💜', color: 'purple' },
  'baidu':  { label: '百度网盘',  icon: '💙', color: 'blue' },
  'aliyun': { label: '阿里云盘',  icon: '💚', color: 'green' },
  'quark':  { label: '夸克网盘',  icon: '🩷', color: 'pink' },
  '123':    { label: '123网盘',   icon: '🧡', color: 'orange' },
  'tianyi': { label: '天翼云盘',  icon: '🩵', color: 'cyan' },
  'magnet': { label: '磁力链接',  icon: '🧲', color: 'gray' },
  'ed2k':   { label: 'ed2k链接',  icon: '🔗', color: 'gray' },
  'thunder':{ label: '迅雷链接',  icon: '⚡', color: 'gray' },
  'other':  { label: '其他',      icon: '📁', color: 'gray' },
};

const REQUEST_SOURCES = [
  { key: 'any',    label: '全选（哪个网盘都行）' },
  { key: '115',    label: '💜 115' },
  { key: 'baidu',  label: '💙 百度' },
  { key: 'aliyun', label: '💚 阿里' },
  { key: 'quark',  label: '🩷 夸克' },
  { key: '123',    label: '🧡 123' },
  { key: 'tianyi', label: '🩵 天翼' },
  { key: 'magnet', label: '🧲 磁力' },
  { key: 'ed2k',   label: '🔗 ed2k' },
];

export default function TmdbFilmDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const id = params.id as string;
  const type = search.get('type') || 'movie';
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showRequest, setShowRequest] = useState(false);
  const [showVipPrompt, setShowVipPrompt] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tmdb-films/${id}?type=${type}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id, type]);

  const handleAction = useCallback((link: LinkItem) => {
    if (!link.canAccess) {
      if (link.lockReason === 'vip_required') setShowVipPrompt(true);
      else if (link.lockReason === 'code') setShowVipPrompt(true);  // 复用弹窗，未来可做付费
      return;
    }
    const isMagnetOrEd2k = link.source === 'magnet' || link.source === 'ed2k' || link.source === 'thunder';
    if (isMagnetOrEd2k) {
      navigator.clipboard.writeText(link.link || '');
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      window.open(link.link, '_blank', 'noopener');
    }
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/40">加载中...</div>;
  }
  if (!data?.tmdb) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/40">
        <div className="text-center">
          <div className="text-2xl mb-2">😢</div>
          <div>未找到该资源（可能 TMDB 拉新还没拉到）</div>
          <Link href="/tmdb-films" className="text-violet-400 hover:underline mt-4 inline-block">← 返回列表</Link>
        </div>
      </div>
    );
  }

  const tmdb = data.tmdb;
  const links: LinkItem[] = data.links || [];
  const sourceGroups: Record<string, LinkItem[]> = data.sourceGroups || {};
  const sourceKeys = Object.keys(sourceGroups);
  const isTv = tmdb.tmdb_type === 'tv';

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Hero */}
      <div className="relative">
        {tmdb.backdrop_path && (
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <img src={`${TMDB_IMG}/original${tmdb.backdrop_path}`} className="w-full h-full object-cover opacity-30 blur-sm" alt="" />
            <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0f]/80 via-[#0a0a0f]/90 to-[#0a0a0f]" />
          </div>
        )}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/tmdb-films" className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-4">
            <ArrowLeft className="w-4 h-4" /> 返回 TMDB 影视
          </Link>
          <div className="flex flex-col md:flex-row gap-6">
            {/* 海报 */}
            <div className="flex-shrink-0 w-48 md:w-64 mx-auto md:mx-0">
              <div className="aspect-[2/3] rounded-xl overflow-hidden bg-gray-800 shadow-2xl shadow-violet-500/20">
                {tmdb.poster_path ? (
                  <img src={`${TMDB_IMG}/w500${tmdb.poster_path}`} alt={tmdb.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-violet-900/30 to-pink-900/30 flex items-center justify-center text-6xl">
                    {isTv ? '📺' : '🎬'}
                  </div>
                )}
              </div>
            </div>
            {/* 信息 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-white/40 mb-2">
                {isTv ? <Tv className="w-3 h-3" /> : <Film className="w-3 h-3" />}
                <span>{isTv ? '剧集' : '电影'} · TMDB ID {tmdb.tmdb_id}</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold">{tmdb.title}</h1>
              {tmdb.original_title && tmdb.original_title !== tmdb.title && (
                <p className="text-white/50 mt-1">{tmdb.original_title}</p>
              )}
              {tmdb.tagline && (
                <p className="text-violet-300/80 italic mt-3 text-sm">"{tmdb.tagline}"</p>
              )}
              {/* 元信息 */}
              <div className="flex flex-wrap items-center gap-3 mt-4 text-sm">
                {tmdb.vote_average > 0 && (
                  <div className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full">
                    <Star className="w-3.5 h-3.5 text-black fill-black" />
                    <span className="text-black font-bold">{tmdb.vote_average.toFixed(1)}</span>
                  </div>
                )}
                {(tmdb.release_date || tmdb.first_air_date) && (
                  <div className="flex items-center gap-1 text-white/70">
                    <Calendar className="w-4 h-4" />
                    <span>{(tmdb.release_date || tmdb.first_air_date).slice(0, 4)}</span>
                  </div>
                )}
                {tmdb.origin_country && Array.isArray(tmdb.origin_country) && tmdb.origin_country.length > 0 && (
                  <div className="flex items-center gap-1 text-white/70">
                    <Globe className="w-4 h-4" />
                    <span>{tmdb.origin_country.join(' / ')}</span>
                  </div>
                )}
                {tmdb.origin_country && typeof tmdb.origin_country === 'string' && tmdb.origin_country && (
                  <div className="flex items-center gap-1 text-white/70">
                    <Globe className="w-4 h-4" />
                    <span>{tmdb.origin_country}</span>
                  </div>
                )}
                {tmdb.runtime && (
                  <div className="text-white/70">{tmdb.runtime} 分钟</div>
                )}
              </div>
              {tmdb.genres && tmdb.genres.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {tmdb.genres.map((g: string) => (
                    <span key={g} className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-xs text-white/60">{g}</span>
                  ))}
                </div>
              )}
              {tmdb.overview && (
                <p className="text-white/60 mt-4 text-sm leading-relaxed max-w-2xl line-clamp-4">{tmdb.overview}</p>
              )}
              {/* 计数 + 求此资源 */}
              <div className="flex flex-wrap items-center gap-3 mt-5">
                <div className="px-3 py-1.5 bg-violet-500/10 text-violet-300 rounded-full text-sm">
                  📦 {data.counts.total} 个链接
                </div>
                {data.counts.locked > 0 && (
                  <div className="px-3 py-1.5 bg-amber-500/10 text-amber-300 rounded-full text-sm">
                    🔒 {data.counts.locked} 个需 VIP
                  </div>
                )}
                <button
                  onClick={() => setShowRequest(true)}
                  className="px-4 py-1.5 bg-gradient-to-r from-pink-600 to-rose-600 rounded-full text-sm font-medium hover:opacity-90 transition"
                >
                  📝 求此资源
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 在线观看区（VIP 锁） */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-2">
        <WatchSection tmdbId={id} type={type} title={tmdb.title} />
      </div>

      {/* 链接区（平铺） */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {links.length === 0 ? (
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8 text-center">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-white/60 mb-4">暂无链接，您可以点击"📝 求此资源"发起请求</div>
            <button
              onClick={() => setShowRequest(true)}
              className="px-6 py-2 bg-gradient-to-r from-pink-600 to-rose-600 rounded-full text-sm font-medium hover:opacity-90 transition"
            >
              📝 求此资源
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Tag className="w-5 h-5 text-violet-400" />
              链接区
            </h2>
            {sourceKeys.map(sk => {
              const meta = SOURCE_META[sk] || SOURCE_META.other;
              const items = sourceGroups[sk];
              return (
                <div key={sk} className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/5">
                    <span className="text-2xl">{meta.icon}</span>
                    <span className="font-medium">{meta.label}</span>
                    <span className="text-xs text-white/40 ml-auto">{items.length} 个链接</span>
                  </div>
                  <div className="space-y-2">
                    {items.map(link => (
                      <div key={link.id} className="flex items-center gap-3 p-3 bg-white/[0.02] hover:bg-white/[0.05] rounded-lg transition">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate" title={link.name}>
                            {link.canAccess ? link.name : <span className="text-white/40">🔒 已锁定（{link.lockReason === 'code' ? `需付费 ¥${link.code_price}` : '需 VIP'}）</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                            {link.size && <span>📦 {link.size}</span>}
                            {link.link_code && <span>🔑 {link.link_code}</span>}
                            {link.view_count > 0 && <span>👁 {link.view_count}</span>}
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              link.import_channel === 'zezhe' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'
                            }`}>
                              {link.import_channel === 'zezhe' ? '泽泽妈妈' : '其他渠道'}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleAction(link)}
                          className={`flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                            link.canAccess
                              ? 'bg-violet-600 hover:bg-violet-500 text-white'
                              : 'bg-white/5 text-white/40 hover:bg-white/10'
                          }`}
                        >
                          {link.canAccess ? (
                            link.source === 'magnet' || link.source === 'ed2k' || link.source === 'thunder' ? (
                              copiedId === link.id ? <><Check className="w-3 h-3 inline" /> 已复制</> : <><Copy className="w-3 h-3 inline" /> 复制</>
                            ) : (
                              <><ExternalLink className="w-3 h-3 inline" /> 打开</>
                            )
                          ) : (
                            <><Lock className="w-3 h-3 inline" /> 锁定</>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 求此资源弹窗 */}
      <AnimatePresence>
        {showRequest && (
          <RequestModal
            tmdb={tmdb}
            onClose={() => setShowRequest(false)}
          />
        )}
        {showVipPrompt && (
          <VipPromptModal onClose={() => setShowVipPrompt(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 求此资源弹窗 ──────────────────────────────────────────────────────
function RequestModal({ tmdb, onClose }: { tmdb: any; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const isAny = selected.includes('any');

  const toggle = (k: string) => {
    if (k === 'any') {
      setSelected(prev => prev.includes('any') ? [] : ['any']);
    } else {
      setSelected(prev => {
        const without = prev.filter(x => x !== 'any');
        return without.includes(k) ? without.filter(x => x !== k) : [...without, k];
      });
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/tmdb-films/${tmdb.tmdb_id}/request?type=${tmdb.tmdb_type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdb_type: tmdb.tmdb_type,
          title: tmdb.title,
          year: (tmdb.release_date || tmdb.first_air_date || '').slice(0, 4),
          region: (tmdb.origin_country || []).join(','),
          poster_path: tmdb.poster_path,
          source_choices: selected,
        }),
      });
      const d = await r.json();
      if (d.success) {
        setDone(true);
        setTimeout(() => onClose(), 2000);
      } else {
        alert(d.error || '提交失败');
      }
    } catch (e) {
      alert('提交失败：' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-[#16161f] border border-white/10 rounded-2xl p-6 max-w-md w-full"
        onClick={e => e.stopPropagation()}
      >
        {done ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <div className="text-lg font-medium">求资源已提交！</div>
            <div className="text-sm text-white/60 mt-2">管理员收到后会尽快处理</div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">📝 求此资源</h3>
              <button onClick={onClose} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4" /></button>
            </div>
            <div className="text-sm text-white/60 mb-3">
              想要 <span className="text-white">{tmdb.title}</span> 的哪个网盘版本？
            </div>
            <div className="space-y-2 mb-5">
              {REQUEST_SOURCES.map(s => {
                const checked = isAny ? s.key === 'any' : selected.includes(s.key);
                return (
                  <label
                    key={s.key}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                      checked ? 'bg-violet-500/20 border border-violet-500/50' : 'bg-white/5 border border-white/5 hover:bg-white/10'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(s.key)}
                      className="w-4 h-4 accent-violet-500"
                    />
                    <span className="text-sm">{s.label}</span>
                  </label>
                );
              })}
            </div>
            <button
              onClick={submit}
              disabled={selected.length === 0 || submitting}
              className="w-full py-3 bg-gradient-to-r from-pink-600 to-rose-600 rounded-xl font-medium disabled:opacity-50"
            >
              {submitting ? '提交中...' : selected.length === 0 ? '请至少选一个' : `发起求资源 (${isAny ? '哪个网盘都行' : selected.length + ' 个网盘'})`}
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── VIP 提示弹窗 ──────────────────────────────────────────────────────
function VipPromptModal({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-gradient-to-br from-violet-900/40 to-pink-900/40 border border-violet-500/30 rounded-2xl p-6 max-w-sm w-full text-center"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-5xl mb-3">🔒</div>
        <h3 className="text-lg font-semibold mb-2">需要 VIP 会员</h3>
        <p className="text-sm text-white/60 mb-5">
          此资源来自其他渠道（不是泽泽妈妈文档导入），<br />
          需要购买 VIP 会员才能打开或复制
        </p>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-white/10 rounded-xl text-sm font-medium"
          >关闭</button>
          <Link
            href="/shop"
            className="flex-1 py-2.5 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl text-sm font-medium"
          >购买 VIP</Link>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── 在线观看区（VIP 锁） ────────────────────────────────────────────
function WatchSection({ tmdbId, type, title }: { tmdbId: string; type: string; title: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ msg: string; code?: string } | null>(null);
  const [activeEmbed, setActiveEmbed] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    // 1) 优先 localStorage.token（登录时存的非 httpOnly）
    // 2) 兜底 document.cookie 里的非 httpOnly token
    // 3) 都拿不到就让 fetch 自动带 httpOnly cookie（API getUser 会从 cookie 读）
    const lsToken = typeof window !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('zzmm_token') || '') : '';
    const cookieToken = typeof document !== 'undefined' ? (document.cookie.match(/(?:^|;\s*)token=([^;]+)/)?.[1] || '') : '';
    const token = lsToken || cookieToken;
    fetch(`/api/tmdb-films/${tmdbId}/watch?type=${type}`, {
      credentials: 'include',  // 同源自动带 httpOnly cookie
      headers: token ? { 'Authorization': `Bearer ${decodeURIComponent(token)}` } : {},
    })
      .then(r => r.json().then(j => ({ status: r.status, json: j })))
      // FAIL-SOFT-WATCH: 始终 setData，VIP 锁用 isLocked 字段判断
      .then(({ status, json }) => {
        setData(json);
        if (json.isLocked) {
          setError({ msg: json.lockReason === 'vip_required' ? 'VIP 专享，登录后可查看' : '请先登录', code: json.lockReason });
        }
      })
      .catch(e => setError({ msg: e.message }))
      .finally(() => setLoading(false));
  }, [tmdbId, type]);

  if (loading) {
    return (
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
        <div className="text-sm text-white/40">🎬 在线观看加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-r from-violet-900/20 to-pink-900/20 border border-violet-500/30 rounded-2xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-violet-400" />
            <div>
              <div className="font-medium flex items-center gap-2">
                🎬 在线观看
                <span className="px-2 py-0.5 bg-violet-500/20 text-violet-300 rounded text-xs">VIP 专享</span>
              </div>
              <div className="text-sm text-white/50 mt-0.5">{error.msg}</div>
            </div>
          </div>
          <Link href="/shop" className="px-4 py-2 bg-gradient-to-r from-violet-600 to-pink-600 rounded-lg text-sm font-medium">
            购买 VIP
          </Link>
        </div>
      </div>
    );
  }

  const videos = data?.videos || [];
  const active = videos.find((v: any) => v.embed_url === activeEmbed) || videos.find((v: any) => v.embed_url);

  return (
    <div className="bg-gradient-to-r from-violet-900/20 to-pink-900/20 border border-violet-500/30 rounded-2xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="text-2xl">🎬</div>
          <div>
            <div className="font-medium flex items-center gap-2">
              在线观看
              <span className="px-2 py-0.5 bg-violet-500/20 text-violet-300 rounded text-xs">VIP 专享</span>
            </div>
            <div className="text-xs text-white/50">TMDB trailers + 公开视频源聚合</div>
          </div>
        </div>
        {data?.keelSearch && (
          <a href={data.keelSearch} target="_blank" rel="noopener" className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> Keel 公开源搜索
          </a>
        )}
      </div>
      {/* 播放器 */}
      {active?.embed_url ? (
        <div className="aspect-video bg-black rounded-xl overflow-hidden mb-3">
          <iframe
            src={active.embed_url}
            className="w-full h-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title={active.name}
          />
        </div>
      ) : (
        <div className="aspect-video bg-black/40 rounded-xl flex flex-col items-center justify-center text-white/40 mb-3">
          <div className="text-4xl mb-2">📭</div>
          <div>暂无可播放源</div>
        </div>
      )}
      {/* 视频列表 */}
      {videos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {videos.slice(0, 6).map((v: any) => (
            <button
              key={v.key}
              onClick={() => v.embed_url && setActiveEmbed(v.embed_url)}
              className={`px-3 py-1.5 rounded-lg text-xs transition ${
                (activeEmbed || active?.embed_url) === v.embed_url
                  ? 'bg-violet-500/30 text-violet-200 border border-violet-500/50'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/5'
              }`}
            >
              <span className="font-mono mr-1.5">▶</span>
              {v.name || v.type}
              <span className="text-white/40 ml-1.5 text-[10px]">{v.site}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
