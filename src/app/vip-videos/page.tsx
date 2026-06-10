'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Search, Lock, ExternalLink, Sparkles, Library, Home, ArrowRight, Film, Tv, Star, Bookmark, BookmarkCheck, Trash2, Flame, RefreshCw, Loader2, ChevronRight } from 'lucide-react';

interface Portal {
  name: string;
  emoji: string;
  desc: string;
  searchUrl: (q: string) => string;
  color: string;
}

const PORTALS: Portal[] = [
  { name: 'B站', emoji: '📺', desc: '正版影视 · 国创 · 纪录片', searchUrl: q => `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`, color: 'from-pink-500 to-rose-600' },
  { name: '西瓜', emoji: '🍉', desc: '头条系 · 电影 · 电视剧', searchUrl: q => `https://www.ixigua.com/search/${encodeURIComponent(q)}/`, color: 'from-orange-500 to-red-500' },
  { name: 'AcFun', emoji: '🎬', desc: '正版番剧 · 影视 · 纪录片', searchUrl: q => `https://www.acfun.cn/search?keyword=${encodeURIComponent(q)}`, color: 'from-pink-400 to-orange-400' },
  { name: '优酷', emoji: '🎞️', desc: '阿里系 · 电影 · 电视剧', searchUrl: q => `https://so.youku.com/search_video/q_${encodeURIComponent(q)}`, color: 'from-blue-500 to-cyan-500' },
  { name: '腾讯', emoji: '🐧', desc: '腾讯系 · 剧 · 综艺 · 动漫', searchUrl: q => `https://v.qq.com/x/search/?q=${encodeURIComponent(q)}`, color: 'from-blue-600 to-indigo-600' },
  { name: '爱奇艺', emoji: '🍿', desc: '百度系 · 院线 · 独家剧', searchUrl: q => `https://so.iqiyi.com/so/q_${encodeURIComponent(q)}`, color: 'from-green-500 to-emerald-500' },
  { name: '芒果', emoji: '🥭', desc: '湖南广电 · 综艺 · 剧集', searchUrl: q => `https://so.mgtv.com/so?k=${encodeURIComponent(q)}`, color: 'from-yellow-500 to-orange-500' },
  { name: '豆瓣', emoji: '📖', desc: '影评 · 高分推荐 · 资料库', searchUrl: q => `https://www.douban.com/search?cat=1002&q=${encodeURIComponent(q)}`, color: 'from-green-600 to-teal-600' },
];

// B 站 tab 切换 (与后端 RID_MAP 对齐)
const TABS = [
  { key: 'all', label: '全站', emoji: '🌐' },
  { key: 'movie', label: '电影', emoji: '🎬' },
  { key: 'tv', label: '剧集', emoji: '📺' },
  { key: 'anime', label: '动漫', emoji: '✨' },
  { key: 'variety', label: '综艺', emoji: '🎤' },
  { key: 'doc', label: '纪录片', emoji: '🎞️' },
];

const QUICK_SEARCHES = [
  '狂飙', '三体', '漫长的季节', '周处除三害', '第二十条',
  '热辣滚烫', '飞驰人生2', '异人之下', '新生', '墨雨云间',
];

interface HotItem {
  rid: number;
  title: string;
  pic: string;
  bvid: string;
  author: string;
  play_label: string;
  danmaku_label: string;
  duration: string;
  watch_url: string;
  bilibili_search: string;
  youku_search: string;
  tencent_search: string;
  iqiyi_search: string;
  mgtv_search: string;
  xigua_search: string;
  acfun_search: string;
  douban_search: string;
}

// localStorage keys
const LS_HISTORY = 'vip_search_history';
const LS_FAVORITES = 'vip_search_favorites';

export default function VipVideosPage() {
  const [q, setQ] = useState('');
  const [locked, setLocked] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  // A. 热门榜单
  const [activeTab, setActiveTab] = useState('all');
  const [hotItems, setHotItems] = useState<HotItem[]>([]);
  const [hotLoading, setHotLoading] = useState(false);
  const [hotCached, setHotCached] = useState(false);
  const [hotAge, setHotAge] = useState('');
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [toast, setToast] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  useEffect(() => {
    // 鉴权 (跟之前一样, 401/403 锁屏)
    const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
    if (!t) { setLocked(true); return; }
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t, 'Cache-Control': 'no-cache' } })
      .then(r => {
        if (!r.ok) { setLocked(true); return r.json(); }
        return r.json();
      })
      .then(d => {
        if (d?.user?.user_group && !['vip', 'admin'].includes(d.user.user_group)) {
          setLocked(true);
        }
      }).catch(() => setLocked(true));

    // 历史 + 收藏
    try {
      setHistory(JSON.parse(localStorage.getItem(LS_HISTORY) || '[]'));
      setFavorites(JSON.parse(localStorage.getItem(LS_FAVORITES) || '[]'));
    } catch {}
  }, []);

  const saveHistory = (kw: string) => {
    if (!kw) return;
    const h = [kw, ...history.filter(x => x !== kw)].slice(0, 8);
    setHistory(h);
    localStorage.setItem(LS_HISTORY, JSON.stringify(h));
  };

  const toggleFavorite = (kw: string) => {
    if (!kw) return;
    let f: string[];
    if (favorites.includes(kw)) {
      f = favorites.filter(x => x !== kw);
    } else {
      f = [kw, ...favorites].slice(0, 50);
    }
    setFavorites(f);
    localStorage.setItem(LS_FAVORITES, JSON.stringify(f));
  };

  const removeFavorite = (kw: string) => {
    const f = favorites.filter(x => x !== kw);
    setFavorites(f);
    localStorage.setItem(LS_FAVORITES, JSON.stringify(f));
  };

  const doSearch = (kw: string) => {
    if (!kw.trim()) return;
    saveHistory(kw.trim());
    setQ(kw.trim());
  };

  // 加载热门
  const loadHot = async (category: string, force = false) => {
    setHotLoading(true);
    setActiveTab(category);
    try {
      const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
      const url = `/api/vip-videos/hot?category=${category}${force ? '&fresh=1' : ''}`;
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
      const d = await r.json();
      if (d.error) {
        showToast(d.error);
      } else {
        setHotItems(d.items || []);
        setHotCached(!!d.cached);
        setHotAge(d.cache_age || '');
      }
    } catch (e: any) {
      showToast('加载失败: ' + e.message);
    } finally {
      setHotLoading(false);
    }
  };

  // 启动后默认加载全站热门
  useEffect(() => {
    if (!locked) loadHot('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  if (locked) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold mb-2">VIP 视频区</h1>
          <p className="text-white/60 mb-6">
            本区域聚合 <b className="text-violet-300">B站 / 西瓜 / AcFun / 优酷 / 腾讯 / 爱奇艺 / 芒果 / 豆瓣</b> 8 个公开搜索源<br />
            <b className="text-amber-300">需要 VIP 会员</b>才能访问
          </p>
          <div className="flex gap-3">
            <Link href="/tmdb-films" className="flex-1 py-3 bg-white/10 rounded-xl text-sm font-medium">
              ← 返回影视区
            </Link>
            <Link href="/activate" className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl text-sm font-medium">
              兑换 VIP
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* 顶部 */}
      <div className="sticky top-0 z-30 bg-[#0a0a0f]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href="/tmdb-films" className="p-2 hover:bg-white/10 rounded-lg">
                <Library className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-400" /> VIP 影视搜索
                </h1>
                <p className="text-xs text-white/40 mt-0.5">8 平台聚合 · 0 服务器带宽 · VIP 赠品</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* 搜索框 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
          <form onSubmit={e => { e.preventDefault(); doSearch(q); }} className="space-y-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="输入影视名: 狂飙 / 三体 / 周处除三害..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-32 py-4 text-base focus:outline-none focus:border-violet-500/50"
                autoFocus
              />
              <button
                type="submit"
                disabled={!q.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
              >
                搜索全网
              </button>
            </div>

            {/* 热搜词 */}
            <div>
              <div className="text-xs text-white/40 mb-2 flex items-center gap-1"><Flame className="w-3 h-3" /> 大家在搜</div>
              <div className="flex flex-wrap gap-2">
                {QUICK_SEARCHES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => doSearch(t)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs transition"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* 历史 + 收藏 两栏 */}
            <div className="grid sm:grid-cols-2 gap-3">
              {/* 历史 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-white/40">🕘 搜索历史</div>
                  {history.length > 0 && (
                    <button type="button" onClick={() => { setHistory([]); localStorage.removeItem(LS_HISTORY); }} className="text-xs text-white/30 hover:text-white/60">
                      清除
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <div className="text-xs text-white/30 py-2">暂无历史</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {history.map(t => (
                      <div key={t} className="flex items-center gap-1 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 rounded-full text-xs">
                        <button type="button" onClick={() => doSearch(t)} className="pl-3 pr-1 py-1.5">{t}</button>
                        <button type="button" onClick={() => toggleFavorite(t)} className="pr-2 py-1.5 text-amber-400 hover:text-amber-300">
                          <Bookmark className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 收藏 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-white/40 flex items-center gap-1"><BookmarkCheck className="w-3 h-3" /> 收藏夹 ({favorites.length})</div>
                  {favorites.length > 0 && (
                    <button type="button" onClick={() => { setFavorites([]); localStorage.removeItem(LS_FAVORITES); }} className="text-xs text-white/30 hover:text-white/60">清空</button>
                  )}
                </div>
                {favorites.length === 0 ? (
                  <div className="text-xs text-white/30 py-2">搜过的片名旁边点 ⭐ 即可收藏</div>
                ) : (
                  <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                    {favorites.map(t => (
                      <div key={t} className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 rounded-full text-xs">
                        <button type="button" onClick={() => doSearch(t)} className="pl-3 pr-1 py-1.5 hover:text-amber-200">{t}</button>
                        <button type="button" onClick={() => removeFavorite(t)} className="pr-2 py-1.5 text-red-400 hover:text-red-300">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </form>
        </div>

        {/* A. 热门榜单 + B. tab 切换 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-400" /> 热门榜单 (B站官方)
              {hotAge && <span className="text-xs text-white/40 font-normal">· 缓存 {hotAge}</span>}
              {hotCached && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">缓存命中</span>}
            </h2>
            <button
              onClick={() => loadHot(activeTab, true)}
              disabled={hotLoading}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs flex items-center gap-1"
            >
              <RefreshCw className={'w-3 h-3 ' + (hotLoading ? 'animate-spin' : '')} /> 刷新
            </button>
          </div>

          {/* B. tab 切换 */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => loadHot(t.key)}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition ${
                  activeTab === t.key
                    ? 'bg-gradient-to-r from-violet-600 to-pink-600 text-white shadow-lg shadow-violet-500/30'
                    : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                }`}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>

          {hotLoading && hotItems.length === 0 ? (
            <div className="text-center py-12 text-white/40 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
            </div>
          ) : hotItems.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-sm">暂无数据</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {hotItems.map((it, i) => (
                <div key={i} className="group cursor-pointer" onClick={() => setExpandedItem(expandedItem === i ? null : i)}>
                  <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-800">
                    <img src={it.pic} alt={it.title} className="w-full h-full object-cover transition group-hover:scale-105" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-red-600 text-white rounded text-[10px] font-bold">
                      #{i + 1}
                    </div>
                    {it.duration && (
                      <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/70 text-white rounded text-[10px] font-mono">
                        {it.duration}
                      </div>
                    )}
                  </div>
                  <h3 className="text-xs text-white mt-1.5 line-clamp-2 group-hover:text-violet-300">{it.title}</h3>
                  <div className="text-[10px] text-white/40 mt-0.5">
                    ▶ {it.play_label} · 💬 {it.danmaku_label}
                  </div>
                  {/* 展开时显示跳转按钮 */}
                  {expandedItem === i && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-2 p-2 bg-white/5 rounded-lg space-y-1.5"
                    >
                      <a href={it.watch_url} target="_blank" rel="noopener" className="flex items-center justify-between text-xs px-2 py-1.5 bg-pink-600 hover:bg-pink-500 rounded">
                        <span>📺 在 B站观看</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {/* D. 联动 TMDB 影视区 */}
                      <Link href={`/tmdb-films?q=${encodeURIComponent(it.title)}`} className="flex items-center justify-between text-xs px-2 py-1.5 bg-violet-600 hover:bg-violet-500 rounded">
                        <span>🎬 本站资源</span>
                        <ChevronRight className="w-3 h-3" />
                      </Link>
                      <div className="text-[10px] text-white/40 pt-1">跳转其他平台:</div>
                      <div className="grid grid-cols-4 gap-1">
                        <a href={it.youku_search} target="_blank" rel="noopener" className="text-[10px] text-center py-1 bg-white/5 hover:bg-white/15 rounded">优酷</a>
                        <a href={it.tencent_search} target="_blank" rel="noopener" className="text-[10px] text-center py-1 bg-white/5 hover:bg-white/15 rounded">腾讯</a>
                        <a href={it.iqiyi_search} target="_blank" rel="noopener" className="text-[10px] text-center py-1 bg-white/5 hover:bg-white/15 rounded">爱奇艺</a>
                        <a href={it.douban_search} target="_blank" rel="noopener" className="text-[10px] text-center py-1 bg-white/5 hover:bg-white/15 rounded">豆瓣</a>
                      </div>
                    </motion.div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 搜索结果 8 平台跳转 */}
        <AnimatePresence mode="wait">
          {q.trim() && (
            <motion.div
              key={q}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#12121a] rounded-2xl p-6 border border-white/5"
            >
              <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-sm text-white/60 mb-1">搜 "<span className="text-violet-300 font-medium">{q}</span>" 在以下平台</div>
                  <div className="text-xs text-white/40">点击跳转新窗口 · 完全免费 · 正版资源</div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => toggleFavorite(q)}
                    className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 ${
                      favorites.includes(q) ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {favorites.includes(q) ? <><BookmarkCheck className="w-3 h-3" /> 已收藏</> : <><Bookmark className="w-3 h-3" /> 收藏</>}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {PORTALS.map(p => (
                  <a
                    key={p.name}
                    href={p.searchUrl(q)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group p-4 bg-gradient-to-br ${p.color} rounded-xl hover:scale-105 transition shadow-lg`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl">{p.emoji}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-white/60 group-hover:text-white" />
                    </div>
                    <div className="text-base font-bold mb-1">{p.name}</div>
                    <div className="text-[10px] text-white/80 leading-tight">{p.desc}</div>
                  </a>
                ))}
              </div>
              {/* D. TMDB 联动入口 */}
              <Link
                href={`/tmdb-films?q=${encodeURIComponent(q)}`}
                className="mt-3 flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-500/20 to-pink-500/20 border border-violet-500/30 rounded-xl hover:bg-violet-500/30 transition"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-300" />
                  <div>
                    <div className="text-sm text-white font-medium">🎬 在本站影视区找 "{q}"</div>
                    <div className="text-[10px] text-white/40">TMDB 8 万+ 资源直接看</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-violet-300" />
              </Link>

              {/* 免责 */}
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs leading-relaxed">
                <b>💡 小提示</b>：本站不存视频内容, 只提供搜索导航。想看"在线试看"用上方 TMDB 联动。
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 说明 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5 text-sm text-white/70 leading-relaxed">
          <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" /> VIP 视频区使用说明
          </h2>
          <ul className="space-y-2 text-xs">
            <li>• <b>本区域为 VIP 赠品</b>，开通 VIP 后即可使用，无需额外付费</li>
            <li>• <b>热门榜单</b>：拉取 B站官方公开排行榜（缓存 5 分钟）, 点 🔽 展开跳转</li>
            <li>• <b>8 平台聚合</b>：一键跳转 B站/西瓜/AcFun/优酷/腾讯/爱奇艺/芒果/豆瓣公开搜索</li>
            <li>• <b>TMDB 联动</b>：搜片名时可直接跳本站 8 万+ 影视资源（在线试看）</li>
            <li>• <b>收藏夹</b>：搜过的片名点 ⭐ 收藏，下次一键回搜</li>
            <li>• 本站不提供完整视频在线播放, 相关版权归原平台所有</li>
          </ul>
        </div>

        <div className="text-center">
          <Link href="/" className="text-sm text-white/30 hover:text-white/60 inline-flex items-center gap-1">
            <Home className="w-3 h-3" /> 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}