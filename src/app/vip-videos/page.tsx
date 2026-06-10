'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Search, Lock, ExternalLink, Sparkles, Library, Home, ArrowRight, Film, Tv, Play } from 'lucide-react';

interface Portal {
  name: string;
  emoji: string;
  desc: string;
  // 搜索 URL 函数: 接受片名 → 返回搜索结果 URL
  searchUrl: (q: string) => string;
  color: string;
  group: 'official' | 'community' | 'free';
}

// 公开搜索站 - 都是各家官方公开搜索接口, 不存内容
const PORTALS: Portal[] = [
  // 官方正版 - 永远不死
  {
    name: 'B站',
    emoji: '📺',
    desc: '正版影视 · 国创 · 纪录片',
    searchUrl: q => `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`,
    color: 'from-pink-500 to-rose-600',
    group: 'official',
  },
  {
    name: '西瓜视频',
    emoji: '🍉',
    desc: '头条系 · 电影 · 电视剧',
    searchUrl: q => `https://www.ixigua.com/search/${encodeURIComponent(q)}/`,
    color: 'from-orange-500 to-red-500',
    group: 'official',
  },
  {
    name: 'AcFun',
    emoji: '🎬',
    desc: '正版番剧 · 影视 · 纪录片',
    searchUrl: q => `https://www.acfun.cn/search?keyword=${encodeURIComponent(q)}`,
    color: 'from-pink-400 to-orange-400',
    group: 'official',
  },
  {
    name: '优酷',
    emoji: '🎞️',
    desc: '阿里系 · 电影 · 电视剧',
    searchUrl: q => `https://so.youku.com/search_video/q_${encodeURIComponent(q)}`,
    color: 'from-blue-500 to-cyan-500',
    group: 'official',
  },
  {
    name: '腾讯视频',
    emoji: '🐧',
    desc: '腾讯系 · 剧 · 综艺 · 动漫',
    searchUrl: q => `https://v.qq.com/x/search/?q=${encodeURIComponent(q)}`,
    color: 'from-blue-600 to-indigo-600',
    group: 'official',
  },
  {
    name: '爱奇艺',
    emoji: '🍿',
    desc: '百度系 · 院线 · 独家剧',
    searchUrl: q => `https://so.iqiyi.com/so/q_${encodeURIComponent(q)}`,
    color: 'from-green-500 to-emerald-500',
    group: 'official',
  },
  {
    name: '芒果TV',
    emoji: '🥭',
    desc: '湖南广电 · 综艺 · 剧集',
    searchUrl: q => `https://so.mgtv.com/so?k=${encodeURIComponent(q)}`,
    color: 'from-yellow-500 to-orange-500',
    group: 'official',
  },
  {
    name: '豆瓣',
    emoji: '📖',
    desc: '影评 · 高分推荐 · 资料库',
    searchUrl: q => `https://www.douban.com/search?cat=1002&q=${encodeURIComponent(q)}`,
    color: 'from-green-600 to-teal-600',
    group: 'official',
  },
];

const QUICK_SEARCHES = [
  '狂飙', '三体', '漫长的季节', '周处除三害', '第二十条',
  '热辣滚烫', '飞驰人生2', '异人之下', '新生', '墨雨云间',
];

export default function VipVideosPage() {
  const [q, setQ] = useState('');
  const [locked, setLocked] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    // 检查 VIP 权限 (跟之前一样, 401/403 锁屏)
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

    // 历史记录
    try {
      const h = JSON.parse(localStorage.getItem('vip_search_history') || '[]');
      setHistory(h);
    } catch {}
  }, []);

  const saveHistory = (kw: string) => {
    if (!kw) return;
    const h = [kw, ...history.filter(x => x !== kw)].slice(0, 8);
    setHistory(h);
    localStorage.setItem('vip_search_history', JSON.stringify(h));
  };

  const doSearch = (kw: string) => {
    if (!kw.trim()) return;
    saveHistory(kw.trim());
    // 把搜索词复制到所有 8 个站点 URL, 用户点哪个跳哪个
    setQ(kw.trim());
  };

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
                <p className="text-xs text-white/40 mt-0.5">输入片名 · 选平台跳转 · 不消耗服务器带宽</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* 搜索框 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5 mb-6">
          <form onSubmit={e => { e.preventDefault(); doSearch(q); }} className="space-y-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input
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
              <div className="text-xs text-white/40 mb-2">🔥 大家在搜</div>
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

            {/* 历史 */}
            {history.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-white/40">🕘 搜索历史</div>
                  <button
                    type="button"
                    onClick={() => { setHistory([]); localStorage.removeItem('vip_search_history'); }}
                    className="text-xs text-white/30 hover:text-white/60"
                  >
                    清除
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {history.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => doSearch(t)}
                      className="px-3 py-1.5 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 rounded-full text-xs transition"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>

        {/* 平台入口 */}
        <AnimatePresence mode="wait">
          {q.trim() ? (
            <motion.div
              key={q}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#12121a] rounded-2xl p-6 border border-white/5"
            >
              <div className="mb-4">
                <div className="text-sm text-white/60 mb-1">搜 "<span className="text-violet-300 font-medium">{q}</span>" 在以下平台</div>
                <div className="text-xs text-white/40">点击跳转新窗口 · 完全免费 · 正版资源</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
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

              {/* 提示 */}
              <div className="mt-5 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs leading-relaxed">
                <b>💡 小提示</b>：
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li>VIP 视频每月通常需要单独会员, 本站不存视频内容, 只提供搜索导航</li>
                  <li>想看"在线试看"请用 <Link href="/tmdb-films" className="text-violet-300 underline">TMDB 影视区</Link> 的第三方播放源</li>
                  <li>想看完整版请支持正版, 或用 115 资源库</li>
                </ul>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-[#12121a] rounded-2xl p-6 border border-white/5"
            >
              <div className="text-sm text-white/60 mb-4 text-center">
                ✨ 选择你想搜的影视, 一键跳转 8 个公开平台搜索结果
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {PORTALS.map(p => (
                  <button
                    key={p.name}
                    onClick={() => doSearch(p.name)}
                    className={`p-4 bg-gradient-to-br ${p.color} rounded-xl hover:scale-105 transition shadow-lg text-left`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl">{p.emoji}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-white/60" />
                    </div>
                    <div className="text-base font-bold mb-1">{p.name}</div>
                    <div className="text-[10px] text-white/80 leading-tight">{p.desc}</div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 说明 */}
        <div className="mt-6 bg-[#12121a] rounded-2xl p-6 border border-white/5 text-sm text-white/70 leading-relaxed">
          <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" /> VIP 视频区使用说明
          </h2>
          <ul className="space-y-2 text-xs">
            <li>• <b>本区域为 VIP 赠品</b>，开通 VIP 后即可使用，无需额外付费</li>
            <li>• 本区域聚合 8 个公开平台的<b>搜索跳转</b>，不存储任何视频内容</li>
            <li>• 本站不提供完整视频在线播放，相关内容版权归原平台所有</li>
            <li>• 如需完整观看，请支持正版或在第三方平台开通会员</li>
            <li>• 想看"在线试看"可去 <Link href="/tmdb-films" className="text-violet-300 underline">TMDB 影视区</Link></li>
          </ul>
        </div>

        <div className="mt-4 text-center">
          <Link href="/" className="text-sm text-white/30 hover:text-white/60 inline-flex items-center gap-1">
            <Home className="w-3 h-3" /> 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}