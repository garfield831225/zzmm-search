'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Toast { id: number; type: 'success' | 'copy' | 'error' | 'unlock' | 'vip'; message: string; }
interface Resource {
  id: number; name: string; link: string; linkCode?: string; source: string; category: string;
  size?: string; type?: string; tags?: string[]; docSheet?: string; subType?: string;
  tmdbIdRaw?: string; viewCount?: number;
  payType?: string; accessLevel?: string; importChannel?: string; lumenCost?: number;
  codePrice?: number;
  unlockId?: number;
  unlocked?: boolean;
}

// 3 大区配置
const SECTIONS = [
  { key: 'zezhe', label: '泽泽妈妈115文档', icon: '👑', desc: 'basic 也可以直接打开' },
  { key: 'vip', label: 'VIP 区', icon: '🔒', desc: 'VIP 可直接打开，basic 看到 VIP 锁' },
  { key: 'code', label: '单独付费区', icon: '💎', desc: '需消耗流明解锁' },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];

const SOURCES_BY_SECTION: Record<SectionKey, string[]> = {
  zezhe: ['全部', '115网盘', '百度网盘', '夸克网盘', '阿里云盘', '磁力链接', 'ed2k链接'],
  vip: ['全部', '115网盘', '百度网盘', '夸克网盘', '磁力链接', 'ed2k链接'],
  code: ['全部', '115网盘', '百度网盘', '夸克网盘', '阿里云盘', '磁力链接', 'ed2k链接'],
};

const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '夸克网盘': 'quark', '123网盘': '123', '天翼云盘': 'tianyi',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k', '迅雷链接': 'thunder',
};
const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};

const SECTION_COLOR: Record<SectionKey, string> = {
  zezhe: 'from-pink-500/20 to-purple-500/20 border-pink-500/40',
  vip: 'from-amber-500/20 to-orange-500/20 border-amber-500/40',
  code: 'from-cyan-500/20 to-blue-500/20 border-cyan-500/40',
};

const SECTION_BADGE: Record<SectionKey, string> = {
  zezhe: 'bg-gradient-to-r from-pink-500 to-purple-500 text-white',
  vip: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white',
  code: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white',
};

export default function LibraryPage() {
  const router = useRouter();
  const [userGroup, setUserGroup] = useState<string>('user');
  const [userId, setUserId] = useState<string>('');
  const [section, setSection] = useState<SectionKey>('zezhe');
  const [source, setSource] = useState<string>('全部');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [unlocking, setUnlocking] = useState<Set<number>>(new Set());
  let toastCnt = 0;

  // 读 user 组
  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u?.group) setUserGroup(u.group);
      if (u?.id) setUserId(String(u.id));
    } catch {}
  }, []);

  const getToken = useCallback(() => {
    return localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
  }, []);

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastCnt;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const isMagnetOrEd2k = (link: string) => link?.startsWith('magnet:') || link?.startsWith('ed2k://');

  const handleCopy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast('copy', `${label}已复制`);
    } catch { addToast('error', '复制失败'); }
  }, [addToast]);

  // 业务逻辑
  // 1) basic 用户在 vip 区: 非 zezhe + access=vip → 锁
  // 2) basic/vip 在 code 区: access=code → 都需要流明解锁 (admin 免)
  // 3) 任何用户在 zezhe 区: 直接打开
  const isVipLocked = (item: Resource): boolean => {
    if (userGroup === 'admin') return false;
    if (item.accessLevel !== 'vip') return false;
    if (userGroup === 'vip') return false;  // VIP 自己也开
    if (userGroup === 'basic') return true;  // basic 看 vip 区
    return true;
  };

  const isAdminDirectOpen = (item: Resource): boolean => {
    return userGroup === 'admin' && item.accessLevel === 'code';
  };

  const isCodeResource = (item: Resource): boolean => {
    return item.accessLevel === 'code';
  };

  const codeResourceLocked = (item: Resource): boolean => {
    if (isAdminDirectOpen(item)) return false;
    if (item.unlocked) return false;  // 已解锁
    return isCodeResource(item);
  };

  const fetchItems = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: p.toString(),
        pageSize: pageSize.toString(),
        zone: `library_${section}`,
        sort: 'import_time_asc',
      });
      if (query) params.set('q', query);
      if (source !== '全部') params.set('source', source);
      const res = await fetch(`/api/search?${params}`, {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      const data = await res.json();
      const newItems = data.items || [];

      // 查 code 资源的解锁状态
      if (section === 'code' && userId) {
        const codeIds = newItems.filter((i: Resource) => i.accessLevel === 'code').map((i: Resource) => i.id);
        if (codeIds.length > 0) {
          try {
            const ur = await fetch(`/api/user/unlocks/list?ids=${codeIds.join(',')}`, {
              headers: { Authorization: 'Bearer ' + getToken() },
            });
            const unlockData = await ur.json();
            const unlockedSet = new Set((unlockData.unlockedIds || []));
            newItems.forEach((i: Resource) => { if (unlockedSet.has(i.id)) i.unlocked = true; });
          } catch {}
        }
      }

      if (p === 1) setItems(newItems);
      else setItems(prev => [...prev, ...newItems]);
      setTotal(data.total || 0);
      setPage(p);
    } catch { addToast('error', '加载失败'); }
    finally { setLoading(false); }
  }, [section, source, query, pageSize, userId, getToken, addToast]);

  useEffect(() => { setItems([]); setPage(1); fetchItems(1); }, [section, source]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); fetchItems(1); };

  const switchSection = (s: SectionKey) => {
    setSection(s);
    setSource('全部');
  };

  // 解锁 code 资源
  const handleUnlock = async (item: Resource) => {
    if (isAdminDirectOpen(item)) {
      // admin 直接打开
      window.open(item.link, '_blank');
      return;
    }
    if (userGroup !== 'basic' && userGroup !== 'vip' && userGroup !== 'admin') {
      addToast('error', '请先登录');
      return;
    }
    if (!confirm(`确认消耗 ${item.lumenCost || 1} 流明解锁此资源？`)) return;
    setUnlocking(prev => new Set(prev).add(item.id));
    try {
      const r = await fetch('/api/resources/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ resourceId: item.id, resourceName: item.name }),
      });
      const d = await r.json();
      if (d.success) {
        addToast('unlock', d.is_admin_bypass ? '👑 admin 免流明打开' : `✅ 解锁成功！扣 ${d.cost || item.lumenCost || 1} 流明`);
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, unlocked: true } : i));
        setTimeout(() => window.open(item.link, '_blank'), 500);
      } else {
        addToast('error', d.error || '解锁失败');
      }
    } catch (e: any) {
      addToast('error', '网络错误: ' + e.message);
    } finally {
      setUnlocking(prev => { const n = new Set(prev); n.delete(item.id); return n; });
    }
  };

  // 复制 + 打开
  const handleOpen = (item: Resource) => {
    if (isMagnetOrEd2k(item.link)) {
      handleCopy(item.link, '磁力/ed2k 链接');
    } else {
      window.open(item.link, '_blank');
    }
  };

  const currentSection = SECTIONS.find(s => s.key === section)!;
  const currentSources = SOURCES_BY_SECTION[section];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link href="/" className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-lg">📋</Link>
              <div>
                <h1 className="text-lg font-bold text-gray-900">资源库</h1>
                <p className="text-xs text-gray-400">三区浏览 · 导入时间从先到后 · {total.toLocaleString()} 条</p>
              </div>
            </div>
            <Link href="/" className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs transition text-gray-600">← 影视区</Link>
          </div>

          {/* 3 大区 Tab */}
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
            {SECTIONS.map(s => {
              const active = s.key === section;
              return (
                <button
                  key={s.key}
                  onClick={() => switchSection(s.key)}
                  className={`flex-1 min-w-[140px] px-3 py-2.5 rounded-xl text-left transition border ${
                    active
                      ? `bg-gradient-to-r ${SECTION_COLOR[s.key]} text-gray-900 shadow-sm`
                      : 'bg-white text-gray-500 hover:bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-lg">{s.icon}</span>
                    <span className="font-medium text-sm">{s.label}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 leading-tight">{s.desc}</div>
                </button>
              );
            })}
          </div>

          {/* 当前区信息条 */}
          <div className={`mb-3 px-3 py-2 rounded-lg text-xs bg-gradient-to-r ${SECTION_COLOR[section]} border flex items-center gap-2`}>
            <span className="font-medium">{currentSection.icon} {currentSection.label}</span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-700">{currentSection.desc}</span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-600">按导入时间从先到后排序</span>
          </div>

          {/* 搜索框 */}
          <form onSubmit={handleSearch} className="flex gap-2 mb-3">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`搜索 ${currentSection.label}...`}
              className="flex-1 bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20"
            />
            <button type="submit" className="px-5 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white transition">
              搜索
            </button>
          </form>

          {/* Source filter */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {currentSources.map(src => (
              <button key={src} onClick={() => setSource(src)}
                className={`px-2.5 py-0.5 rounded text-xs whitespace-nowrap transition ${source === src ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-700'}`}>
                {src}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          {/* Table header */}
          <div className="grid grid-cols-[60px_70px_1fr_90px_80px_70px_70px_70px_140px] gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div>分类</div>
            <div>标签</div>
            <div>名称</div>
            <div>来源</div>
            <div>大小</div>
            <div>提取码</div>
            <div>导入时间</div>
            <div>状态</div>
            <div>操作</div>
          </div>

          {items.map((item) => {
            const isVipLock = isVipLocked(item);
            const isAdmin = isAdminDirectOpen(item);
            const isCodeLock = codeResourceLocked(item);
            const isUnlocked = item.unlocked;

            return (
              <div key={item.id}
                className={`grid grid-cols-[60px_70px_1fr_90px_80px_70px_70px_70px_140px] gap-2 px-3 py-2 border-b border-gray-100 hover:bg-violet-50/30 transition text-sm items-center ${isVipLock ? 'bg-amber-50/30' : ''} ${isCodeLock ? 'bg-cyan-50/30' : ''}`}>
                {/* 分类 */}
                <div>
                  <div className="text-base">{getCategoryIcon(item.category)}</div>
                  <div className="text-[10px] text-gray-400 truncate">{item.category}</div>
                </div>
                {/* 标签 (大区角标) */}
                <div>
                  <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium text-center ${SECTION_BADGE[section]}`}>
                    {section === 'zezhe' ? '👑 ZEZHE' : section === 'vip' ? '🔒 VIP' : '💎 CODE'}
                  </div>
                  {item.payType === 'code' && section === 'vip' && (
                    <div className="text-[9px] text-amber-600 mt-0.5 text-center">💎付费</div>
                  )}
                </div>
                {/* 名称 */}
                <div className="min-w-0">
                  <div className="text-gray-900 font-medium text-sm leading-snug line-clamp-2" title={item.name}>{item.name}</div>
                  {item.tmdbIdRaw && item.tmdbIdRaw !== 'NOMATCH' && item.tmdbIdRaw !== 'GARBLED' && item.tmdbIdRaw.length >= 4 && (
                    <div className="text-[10px] text-green-600 font-mono mt-0.5">🎬 TMDB: {item.tmdbIdRaw}</div>
                  )}
                </div>
                {/* 来源 */}
                <div className="text-xs text-gray-500 truncate">{SOURCE_DISPLAY_MAP[item.source] || item.source || '—'}</div>
                {/* 大小 */}
                <div className="text-xs text-gray-400 truncate">{item.size || '—'}</div>
                {/* 提取码 */}
                <div className="text-xs">
                  {item.linkCode ? (
                    <button onClick={() => handleCopy(item.linkCode!, '提取码')} className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded text-[11px] font-mono" title="点击复制提取码">
                      {item.linkCode}
                    </button>
                  ) : <span className="text-gray-300">—</span>}
                </div>
                {/* 导入时间 */}
                <div className="text-[10px] text-gray-400 font-mono" title={item.tmdbIdRaw}>
                  {/* 简单时间显示 (创建时间顺序) */}
                  <div className="text-gray-600">#{item.id}</div>
                </div>
                {/* 状态 */}
                <div className="text-xs">
                  {isVipLock && <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-700 rounded text-[10px]">🔒 锁</span>}
                  {isUnlocked && <span className="px-1.5 py-0.5 bg-green-500/20 text-green-700 rounded text-[10px]">✓ 已解锁</span>}
                  {isAdmin && <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-700 rounded text-[10px]">👑 免流明</span>}
                </div>
                {/* 操作 */}
                <div className="flex gap-1">
                  {isMagnetOrEd2k(item.link) && !isVipLock && !isCodeLock ? (
                    <button onClick={() => handleCopy(item.link, '链接')}
                      className="px-2 py-1 bg-violet-600 hover:bg-violet-500 rounded text-[10px] text-white font-medium transition">
                      📋 复制
                    </button>
                  ) : isVipLock ? (
                    <button onClick={() => addToast('vip', '需要 VIP 才能打开')} disabled
                      className="px-2 py-1 bg-amber-500/30 text-amber-700 rounded text-[10px] font-medium cursor-not-allowed">
                      🔒 VIP 锁
                    </button>
                  ) : isCodeLock ? (
                    <button onClick={() => handleUnlock(item)} disabled={unlocking.has(item.id)}
                      className="px-2 py-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 rounded text-[10px] text-white font-medium transition disabled:opacity-50">
                      {unlocking.has(item.id) ? '解锁中...' :
                        isAdmin ? '👑 免流明' :
                        isUnlocked ? '🔓 已解锁' :
                        `💎 解锁 (${item.lumenCost || 1}流明)`}
                    </button>
                  ) : (
                    <button onClick={() => handleOpen(item)}
                      className="px-2 py-1 bg-violet-600 hover:bg-violet-500 rounded text-[10px] text-white font-medium transition">
                      {isMagnetOrEd2k(item.link) ? '📋 复制' : '🔗 打开'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {items.length === 0 && !loading && (
            <div className="py-16 text-center text-gray-400 text-sm">
              {section === 'code' ? '💎 暂无单独付费资源' : section === 'vip' ? '🔒 暂无 VIP 资源' : '👑 暂无泽泽妈妈文档资源'}
            </div>
          )}

          {loading && (
            <div className="py-8 text-center text-gray-400 text-sm">加载中...</div>
          )}
        </div>

        {items.length < total && (
          <div className="flex justify-center mt-6">
            <button onClick={() => fetchItems(page + 1)} disabled={loading}
              className="px-8 py-3 bg-white hover:bg-gray-100 border border-gray-200 rounded-xl text-sm text-gray-700 disabled:opacity-50 transition shadow-sm">
              {loading ? '加载中...' : `加载更多 (剩余 ${(total - items.length).toLocaleString()} 条)`}
            </button>
          </div>
        )}

        <div className="text-center mt-3 text-xs text-gray-400">
          共 {total.toLocaleString()} 条，当前显示 {items.length.toLocaleString()} 条
        </div>
      </main>

      <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg ${
                t.type === 'copy' ? 'bg-green-600 text-white' :
                t.type === 'unlock' ? 'bg-emerald-600 text-white' :
                t.type === 'vip' ? 'bg-amber-500 text-white' :
                'bg-red-500 text-white'
              }`}>
              {t.type === 'copy' ? '📋' : t.type === 'unlock' ? '✅' : t.type === 'vip' ? '🔒' : '✕'} {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    '电影': '🎬', '剧集': '📺', '动漫': '🈴', '纪录片': '📽️',
    '综艺': '🎭', '演唱会': '🎤', '连载': '🆕',
    '原盘': '💿', 'REMUX': '🔧', '系列电影': '🎞️',
    '合集': '📦', '音乐': '🎵', '体育': '⚽', '少儿频道': '🧒',
    '电子书': '📚', '精品课': '🎓', '文档': '📄',
  };
  return icons[category] || '📁';
}
