'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Music, Library, LogOut, CreditCard, ShoppingCart, Film, Tv, Shield, Crown, User, Gift, Sparkles, ChevronRight } from 'lucide-react';
import HomeBanner from '@/components/home/Banner';
import HomeSection, { type SectionItem } from '@/components/home/Section';
import TrailerRow from '@/components/home/TrailerRow';
import { tmdbPoster, tmdbBackdrop, tmdbProfile, TMDB_FALLBACK } from '@/lib/tmdb-image';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMAGE_FALLBACK = TMDB_FALLBACK;

const CATEGORIES = ['全部', '连载', '电影', '剧集', '动漫', '少儿频道', '综艺', '演唱会', '纪录片', '原盘', 'REMUX', '系列电影'];
const SOURCES = ['全部', '115网盘', '百度网盘', '阿里云盘', '夸克网盘', '磁力链接', 'ed2k链接'];
const REGIONS = ['全部', '大陆', '欧美', '日韩', '港澳台'];
const YEARS = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020', '2010-2019', '2000-2009'];

// 2026-08-02: 后端 admin/links DELETE 给主表 source 加 ' [deleted]' 后缀标记软删的链接
//   (避免清 link 字段撞 xx_resources_link_name_unique)
//   前端展示时要去掉这个后缀, 不然用户看到 "aliyun [deleted]" 这种怪标签
function cleanSource(s: string | undefined | null): string {
  if (!s) return '';
  return String(s).replace(/ \[deleted\]$/, '');
}

interface DownloadToast {
  id: number;
  type: 'success' | 'cooldown' | 'limit' | 'banned' | 'error' | 'warning';  // 2026-07-26 + warning (replica lag 提示)
  message: string;
}

interface TmdbInfo {
  title: string;
  title_zh: string;
  poster_path: string;
  vote_average: string;
  vote_count: number;
  overview: string;
  release_date: string;
  tagline: string;
  original_title: string;
  genres: string[];
}

interface CreditPerson {
  name: string;
  character: string;
  profile_path: string;
  known_for_department: string;
}

interface ResourceItem {
  id: number;
  name: string;
  link: string;
  linkCode: string;
  source: string;
  sourceKey: string;
  category: string;
  size: string;
  type: string;
  tags: string[];
  tmdbId: string;
  tmdbIdRaw?: string;  // 2026-07-20: tmdb 原始值 (含 NOMATCH/空)
  viewCount: number;
  tmdb: TmdbInfo | null;
  isCurrent?: boolean;
  credits?: { director: CreditPerson[]; cast: CreditPerson[] };
  // 2026-06-03 单资源付费
  payType?: 'free' | 'code';
  codePrice?: number;
  unlocked?: boolean;
  lumenCost?: number;  // 2026-06-25 单条定价流明
  accessTier?: 'document' | 'vip' | 'unlock' | 'free';  // 2026-06-25 资源分级
  accessLevel?: string;  // 2026-06-25 兼容旧 access_level 字段
  importChannel?: string;  // 2026-07-14 泽泽妈专属标识
  links?: Array<{ source: string; url: string; password: string; sort: number; accessLevel?: string; status?: string }>;  // 2026-07-17 1对N 多链接
  // 2026-07-27: 同 tmdb_id 的所有 link (dedup 之前的所有版本, 按 source 优先级 + 新上传排序)
  tmdbLinks?: Array<{ id: number; source: string; url: string; password: string; size: string; accessLevel: string; sort: number; status: string; createdAt: string }>;
  tmdbLinkCount?: number;  // 总数, 卡片可显示 "+N" 徽章
}

interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  items: ResourceItem[];
  categories: string[];
  sources: string[];
  groups?: { tmdbId: string; name: string; count: number }[];  // 2026-07-20: 同 TMDB 分组
  dedupBy?: 'tmdb_id' | 'id';  // 2026-07-20: 实际生效的去重模式
}

function StarRating({ score }: { score: number }) {
  const stars = Math.round((score / 10) * 5);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`text-xs ${i <= stars ? 'text-yellow-400' : 'text-white/20'}`}>★</span>
      ))}
      <span className="text-xs text-white/60 ml-1">{score.toFixed(1)}</span>
    </div>
  );
}

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [source, setSource] = useState('全部');
  const [region, setRegion] = useState('全部');
  const [year, setYear] = useState('全部');
  const [sort, setSort] = useState('release_date');
  const [pageSize, setPageSize] = useState(30);
  // 2026-07-20: dedupBy 控制是否按 tmdb_id 去重 ('tmdb_id' 默认去重 | 'id' 不去重看全部)
  const [dedupBy, setDedupBy] = useState<'tmdb_id' | 'id'>('tmdb_id');
  const [groups, setGroups] = useState<{ tmdbId: string; name: string; count: number }[]>([]);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ResourceItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [relatedItems, setRelatedItems] = useState<ResourceItem[]>([]);
  const [tmdbType, setTmdbType] = useState<string>('movie');
  const [tmdbCredits, setTmdbCredits] = useState<{ director: any[]; cast: any[]; overview: string; tagline: string; original_title: string; vote_count: number; genres: string[] } | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [user, setUser] = useState<{ id: number; username: string; group: string; expire_at: string } | null>(null);
  const isAdmin = user?.group === 'admin';
  const getToken = () => localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [downloadToasts, setDownloadToasts] = useState<DownloadToast[]>([]);
  const [copyToasts, setCopyToasts] = useState<DownloadToast[]>([]);
  // 2026-06-03 单资源付费 unlock modal
  const [unlockItem, setUnlockItem] = useState<ResourceItem | null>(null);
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [lumenBalance, setLumenBalance] = useState<number>(0);  // 2026-06-25
  const [unlockMode, setUnlockMode] = useState<'code' | 'lumen'>('lumen');  // 默认走流明
  let toastCounter = 0;
  let copyToastCounter = 0;

  // 2026-08-04: 首页 4 模块行 (Banner + 最新上映 + Basic 专区 + VIP 专区 + 主题专区)
  const [secUpcoming, setSecUpcoming] = useState<SectionItem[]>([]);
  const [secBasic, setSecBasic] = useState<SectionItem[]>([]);
  const [secVip, setSecVip] = useState<SectionItem[]>([]);
  const [secThemes, setSecThemes] = useState<{ id: number; name: string; slug: string; item_count: number }[]>([]);
  const [secLoading, setSecLoading] = useState(true);

  useEffect(() => {
    // 2026-08-04: 4 模块并发加载, 取小数据 pageSize=12
    let cancelled = false;
    const load = async () => {
      try {
        const [upRes, baRes, vipRes, thRes] = await Promise.allSettled([
          fetch('/api/upcoming?type=all&pageSize=12'),
          fetch('/api/basic?pageSize=12'),
          fetch('/api/vip?pageSize=12'),
          fetch('/api/themes'),
        ]);
        if (cancelled) return;
        const upData = upRes.status === 'fulfilled' ? await upRes.value.json() : { items: [] };
        const baData = baRes.status === 'fulfilled' ? await baRes.value.json() : { items: [] };
        const vipData = vipRes.status === 'fulfilled' ? await vipRes.value.json() : { items: [] };
        const thData = thRes.status === 'fulfilled' ? await thRes.value.json() : { themes: [] };
        setSecUpcoming((upData.items || []).map(mapToSection));
        setSecBasic((baData.items || []).map(mapToSection));
        setSecVip((vipData.items || []).map(mapToSection));
        setSecThemes(thData.themes || []);
        setSecLoading(false);
      } catch (e) {
        if (!cancelled) setSecLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // 将 API item 映射到 SectionItem
  // 2026-08-08: /api/upcoming|basic|vip 返的是 resourceId (xx_resources.id), 不是 id
  //   之前 it.id → undefined, section 渲染空卡片
  function mapToSection(it: any): SectionItem {
    return {
      id: it.resourceId || it.id,
      tmdbId: it.tmdbId || it.tmdb_id,
      title: it.title || it.name || '',
      posterUrl: it.posterUrl || it.poster_url || (it.posterPath ? tmdbPoster(it.posterPath, 'card') : '') || '',
      releaseDate: it.releaseDate || it.release_date,
      voteAverage: it.voteAverage ?? it.vote_average,
      source: it.source,
      resourceCount: it.resourceCount ?? it.resource_count,
      accessLevel: it.accessLevel ?? it.access_level,
      importChannel: it.importChannel ?? it.import_channel,
      payType: it.payType ?? it.pay_type,
      category: it.category,
      tmdbType: it.tmdbType ?? it.tmdb_type,
    };
  }

  const addToast = useCallback((type: DownloadToast['type'], message: string) => {
    const id = ++toastCounter;
    setDownloadToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setDownloadToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const handleDirectOpen = useCallback((link: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (link) window.open(link, '_blank');
    else addToast('error', '链接无效');
  }, [addToast]);

  const extractCodeFromUrl = (link: string): string | null => {
    if (!link) return null;
    const match = link.match(/[?&]password=([^&]+)/i);
    return match ? match[1] : null;
  };

  const handleDownload = useCallback(async (resourceId: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const token = localStorage.getItem('token');
    if (!token) { addToast('error', '请先登录'); return; }
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ resourceId }),
      });
      const data = await res.json();
      if (data.success && data.url) {
        addToast('success', '正在跳转...');
        setTimeout(() => window.open(data.url, '_blank'), 500);
      } else {
        addToast('error', data.message || '下载失败');
      }
    } catch { addToast('error', '网络错误，请重试'); }
  }, [addToast]);

  const isMagnetOrEd2k = useCallback((link: string) => {
    return link?.startsWith('magnet:') || link?.startsWith('ed2k://');
  }, []);

  const addCopyToast = useCallback((msg: string) => {
    const id = ++copyToastCounter;
    setCopyToasts(prev => [...prev, { id, type: 'success', message: msg }]);
    setTimeout(() => setCopyToasts(prev => prev.filter(t => t.id !== id)), 2000);
  }, []);

  const handleCopyLink = useCallback(async (link: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try { await navigator.clipboard.writeText(link); addCopyToast('已复制到剪贴板'); }
    catch { addCopyToast('复制失败，请手动复制'); }
  }, [addCopyToast]);

  // 2026-06-04: 强制激活守卫 — 已登录但 group='user' (未激活) 必须输入激活码
  const [mustActivate, setMustActivate] = useState(false);
  useEffect(() => {
    setMounted(true);
    // 2026-07-16: localStorage 兜底 - 刷新/新窗口时可能丢了, 但 cookie 还在
    // 调 /api/auth/me 同步 localStorage
    const sync = async () => {
      let stored = localStorage.getItem('user');
      if (!stored) {
        try {
          const r = await fetch('/api/auth/me', { credentials: 'include' });
          if (r.ok) {
            const d = await r.json();
            if (d.token) {
              localStorage.setItem('token', d.token);
            }
            if (d.user) {
              const u = {
                id: d.user.id, username: d.user.username,
                group: d.user.user_group, expire_at: d.user.expire_at,
              };
              localStorage.setItem('user', JSON.stringify(u));
              stored = JSON.stringify(u);
            }
          }
        } catch {}
      }
      if (stored) {
        try {
          const u = JSON.parse(stored);
          setUser(u);
          setMustActivate(!u.group || u.group === 'user');
        } catch {}
      }
    };
    sync();
  }, []);

  // 用 ref 记录最新 state，在 effect 调用 fetchItems 之前同步最新值
  const latestRef = useRef({ query, category, source, region, year, sort, pageSize, dedupBy });
  latestRef.current = { query, category, source, region, year, sort, pageSize, dedupBy };

  // 空 deps —— 永远同一函数引用，永远用 latestRef 读最新 state
  const fetchItems = useCallback(async (p?: number) => {
    const targetPage = p !== undefined ? p : 1;
    setPage(targetPage);
    setLoading(true);
    const { query: q, category: cat, source: src, region: reg, year: yr, sort: s, pageSize: ps, dedupBy: db } = latestRef.current;
    try {
      const params = new URLSearchParams({ page: targetPage.toString(), pageSize: ps.toString() });
      if (q) params.set('q', q);
      if (cat !== '全部') params.set('category', cat);
      if (src !== '全部') params.set('source', src);
      if (reg !== '全部') params.set('region', reg);
      if (yr !== '全部') params.set('year', yr);
      params.set('sort', s);
      // 2026-07-20: dedupBy 决定是否按 tmdb_id 去重
      params.set('dedupBy', db);
      // 2026-06-26: 传 Bearer token 让 search API 识别 admin/basic/vip user_group, 否则永远 0 条
      // 2026-07-20: cache: 'no-store' + ts= 强制绕开浏览器 + Vercel Edge + Next.js fetch cache
      // (修了万米危机"还在"的 bug, 真实 DB 已是 0 但浏览器 cache 还在)
      // 2026-07-25: zzmm_token 是 httpOnly cookie 同步到 localStorage 的字段名, 必须 fallback
      const token = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
      params.set('_t', Date.now().toString());
      const res = await fetch(`/api/search?${params}`, {
        cache: 'no-store',
        credentials: 'include',  // 2026-07-25: 带 cookie 鉴权 (server 端 JWT 解码)
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data: SearchResponse = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      // 2026-07-20: 记录分组 (按 tmdb_id), 用于"显示重复"按钮
      setGroups(data.groups ?? []);
    } catch (err) { console.error('Fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  // 先同步 ref 再调用，永远读最新 state
  useEffect(() => {
    latestRef.current = { query, category, source, region, year, sort, pageSize, dedupBy };
    fetchItems(1);
  }, [category, source, region, year, sort, pageSize, dedupBy]); // eslint-line -- stable deps


  useEffect(() => { fetchItems(1); }, [category, source, region, year, sort, pageSize, dedupBy]);

  // 2026-07-17: 真正退出 - 清 httpOnly cookie + localStorage + 跳 /
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    localStorage.removeItem('token');
    localStorage.removeItem('zzmm_token');
    localStorage.removeItem('adminToken');
    localStorage.removeItem('user');
    setUser(null);
    router.push('/');
    router.refresh();
  };

  // 2026-06-03 单资源付费 - 解锁处理 (2026-06-25 + 流明模式)
  const handleUnlock = async () => {
    if (!unlockItem) return;
    if (unlockMode === 'code' && !unlockCode.trim()) {
      setUnlockError('请输入激活码');
      return;
    }
    if (!user) {
      setUnlockError('请先登录');
      return;
    }
    setUnlockLoading(true);
    setUnlockError('');
    try {
      const token = localStorage.getItem('token') || '';
      const body: any = { resource_id: unlockItem.id };
      if (unlockMode === 'code') body.code = unlockCode.trim();
      else body.use_lumen = true;
      const r = await fetch('/api/resources/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.success) {
        // 更新本地状态
        setItems(prev => prev.map(i => i.id === unlockItem.id ? { ...i, unlocked: true } : i));
        if (selectedItem?.id === unlockItem.id) {
          setSelectedItem(prev => prev ? { ...prev, unlocked: true } : prev);
        }
        if (typeof data.lumen_balance_after === 'number') setLumenBalance(data.lumen_balance_after);
        setUnlockItem(null);
        setUnlockCode('');
        addToast('success', `🎉 解锁成功: ${data.resource.name}${unlockMode === 'lumen' ? ` (消耗 ${data.lumen_cost} 流明)` : ''}`);
      } else {
        setUnlockError(data.error || '解锁失败');
      }
    } catch (e: any) {
      setUnlockError('网络错误: ' + e.message);
    }
    setUnlockLoading(false);
  };

  const openUnlock = async (item: ResourceItem) => {
    if (!user) {
      addToast('error', '请先登录');
      return;
    }
    setUnlockItem(item);
    setUnlockCode('');
    setUnlockError('');
    // 查询当前流明余额
    try {
      const token = localStorage.getItem('token') || '';
      const r = await fetch('/api/user/balance', { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      if (typeof data.balance === 'number') setLumenBalance(data.balance);
    } catch {}
  };

  // 2026-07-15: VIP 锁 - basic 用户看非 zezhe 资源时禁止打开 (前端展示锁)
  // 2026-07-27: 兼容 zezhe + zezemom_excel 两种命名 (历史上有混用)
  const isZezheChannel = (ch?: string) => ch === 'zezhe' || ch === 'zezemom_excel';
  const isVipLocked = (item: ResourceItem): boolean => {
    if (!user) return false;
    if (user.group !== 'basic') return false;  // 只有 basic 用户才会被锁
    if (isZezheChannel(item.importChannel)) return false;  // 泽泽妈永远不锁
    if (item.accessLevel === 'code') return false;  // 单资源付费走流明解锁
    return true;  // 其他都锁
  };

  const handleItemClick = async (item: ResourceItem) => {
    // 2026-07-15: VIP 锁拦截
    if (isVipLocked(item)) {
      addToast('error', '🔒 VIP 资源，basic 用户不可直接打开，请升级 VIP');
      return;
    }
    setSelectedItem(item);
    setHistoryExpanded(false);
    setTmdbCredits(null);
    if (item.tmdbId) {
      setDetailLoading(true);
      try {
        const tmdbTypeGuess = item.category === '连载' || item.category === '剧集' || item.category === '动漫' || item.category === '综艺' ? 'tv' : 'movie';
        // 2026-07-31: 加 /api/resource/links-by-tmdb 拿同剧所有 link (按源优先级 + 最新置顶)
        const [relRes, credRes, linksRes] = await Promise.all([
          fetch(`/api/resource/${item.id}/related`),
          fetch(`/api/admin/tmdb-credits?tmdbId=${item.tmdbId}&type=${tmdbTypeGuess}`),
          fetch(`/api/resource/links-by-tmdb?tmdb_id=${encodeURIComponent(item.tmdbId)}`),
        ]);
        const relData = await relRes.json();
        const credData = await credRes.json();
        const linksData = await linksRes.json();
        setRelatedItems(relData.items || []);
        setTmdbType(relData.tmdbType || 'movie');
        if (credData.director || credData.cast) {
          setTmdbCredits(credData);
        }
        // 2026-07-31: 用 links-by-tmdb API 覆盖 selectedItem.tmdbLinks (按源优先级 + 最新置顶)
        if (linksData.links && Array.isArray(linksData.links) && linksData.links.length > 0) {
          setSelectedItem(prev => prev ? {
            ...prev,
            tmdbLinks: linksData.links.map((l: any) => ({
              id: l.id,
              source: l.source,
              url: l.url,
              password: l.password,
              size: l.size,
              accessLevel: l.accessLevel,
              importChannel: l.importChannel,
              resourceName: l.name,
              createdAt: l.createdAt,
            }))
          } : prev);
        }
      } catch {}
      setDetailLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white relative">
      {/* 2026-07-25: 顶部 hero 光晕 (深空黑 + 紫粉 radial gradient, 克制版) */}
      <div className="absolute inset-0 pointer-events-none opacity-30" style={{
        backgroundImage: 'radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.12) 0%, transparent 45%), radial-gradient(circle at 80% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 50%), radial-gradient(circle at 50% 50%, rgba(236, 72, 153, 0.05) 0%, transparent 60%)'
      }} />
      <div className="relative z-0">
      {/* 2026-06-04: 强制激活守卫 — 已登录但未激活任何资源 */}
      {/* 2026-07-29: 新规则 - 注册默认 basic, 不会再触发此守卫. 仅作防御保留给历史 user 账户 */}
      {mounted && mustActivate && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-md bg-[#12121a] rounded-2xl p-8 border border-white/10 shadow-2xl"
          >
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">💎</div>
              <h2 className="text-2xl font-bold mb-2">升级 VIP 享受全部资源</h2>
              <p className="text-sm text-white/60">基础资源可正常浏览，VIP 资源需升级会员后解锁</p>
            </div>
            <button
              onClick={() => router.push('/activate')}
              className="w-full py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-semibold hover:opacity-90 transition"
            >
              💎 升级 VIP
            </button>
            <button
              onClick={() => router.push('/upgrade')}
              className="w-full mt-3 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm transition"
            >
              🛒 没有激活码？去购买
            </button>
            <div className="mt-6 text-center text-xs text-white/40">
              联系站长微信 HKmaipanren 获取激活码
            </div>
            <button
              onClick={handleLogout}
              className="w-full mt-2 text-xs text-white/30 hover:text-white/60 transition"
            >
              退出登录
            </button>
          </motion.div>
        </div>
      )}
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0f]/70 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {/* 2026-08-08: HDZZMM 紫粉霓虹 logo v5-01 (跟主站主题色一致, 紫粉渐变 + 青色边缘高光) - 替代原紫色方块+emoji */}
              <img
                src="/logo-hdzzmm.png"
                alt="HDZZMM"
                width={48}
                height={48}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex-shrink-0 shadow-[0_0_16px_rgba(168,85,247,0.3)]"
                loading="eager"
                decoding="async"
              />
              <div className="min-w-0">
                <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent tracking-wide">HDZZMM</h1>
                <p className="text-xs text-white/40 truncate">共 {total.toLocaleString()} 条资源 · 当前显示 {items.length} 条</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {user ? (
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <span className="px-3 py-1.5 bg-violet-600/30 rounded-lg text-sm text-violet-300">{user.username}</span>
                  {/* 2026-07-29: 个人中心入口 (所有已登录用户) */}
                  <Link href="/profile" className="group flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/40 hover:to-blue-500/40 rounded-lg text-sm transition-all duration-200 text-cyan-200 hover:shadow-[0_0_12px_rgba(34,211,238,0.4)] hover:scale-105 border border-cyan-400/30">
                    <User size={14} className="transition-transform group-hover:scale-110" />
                    <span>个人中心</span>
                  </Link>
                  {/* 2026-07-29: VIP 影视区入口 (basic/vip/admin 都能看见, basic 点进去看升级提示) */}
                  {['basic', 'vip', 'admin'].includes(user?.group || '') && (
                    <Link href="/vip" className="group flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500/20 to-pink-500/20 hover:from-amber-500/40 hover:to-pink-500/40 rounded-lg text-sm transition-all duration-200 text-amber-200 hover:shadow-[0_0_12px_rgba(245,158,11,0.4)] hover:scale-105 border border-amber-400/30">
                      <Crown size={14} className="transition-transform group-hover:scale-110" />
                      <span>VIP 影视区</span>
                    </Link>
                  )}
                  {/* 2026-07-31: VIP 影视 2 区入口 (basic 跳 /upgrade, vip/admin 直接进 /lovemovie 镜像站)
                      2026-08-08 修: 之前所有角色都 Link /lovemovie, basic 看不到 /upgrade 入口
                      之前 CF tunnel 配 lovemovie.zzmm-search.uk -> 外部 URL, 8-7 配 tunnel 时被覆盖 PUT 删了
                      现在 /lovemovie 是 src/app/lovemovie/page.tsx (iframe 嵌入, URL 在 NEXT_PUBLIC_LOVEMOVIE_URL) */}
                  {['basic', 'vip', 'admin'].includes(user?.group || '') && (
                    user?.group === 'basic' ? (
                      <Link href="/upgrade" className="group flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 hover:from-violet-500/40 hover:to-fuchsia-500/40 rounded-lg text-sm transition-all duration-200 text-violet-200 hover:shadow-[0_0_12px_rgba(167,139,250,0.4)] hover:scale-105 border border-violet-400/30">
                        <Sparkles size={14} className="transition-transform group-hover:scale-110" />
                        <span>VIP 影视 2 区 (升级)</span>
                      </Link>
                    ) : (
                      <Link href="/lovemovie" target="_blank" rel="noopener" className="group flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 hover:from-violet-500/40 hover:to-fuchsia-500/40 rounded-lg text-sm transition-all duration-200 text-violet-200 hover:shadow-[0_0_12px_rgba(167,139,250,0.4)] hover:scale-105 border border-violet-400/30">
                        <Sparkles size={14} className="transition-transform group-hover:scale-110" />
                        <span>VIP 影视 2 区</span>
                      </Link>
                    )
                  )}
                  {/* 2026-07-15 隐藏: 用户要求不要显示 TMDB 影视区 + VIP 观影区 入口
                  <Link href="/tmdb-films" className="group flex items-center gap-1.5 px-3 py-1.5 bg-pink-600/20 hover:bg-pink-600/50 rounded-lg text-sm transition-all duration-200 text-pink-300 hover:shadow-[0_0_12px_rgba(236,72,153,0.4)] hover:scale-105">
                    <Film size={14} className="transition-transform group-hover:scale-110" />
                    <span>TMDB 影视区</span>
                  </Link>
                  <Link href="/vip-videos" className="group flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/50 rounded-lg text-sm transition-all duration-200 text-violet-300 hover:shadow-[0_0_12px_rgba(167,139,250,0.4)] hover:scale-105">
                    <Tv size={14} className="transition-transform group-hover:scale-110" />
                    <span>VIP 观影区</span>
                  </Link>
                  */}
<Link href="/nonfilm" className="group flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/50 rounded-lg text-sm transition-all duration-200 text-cyan-300 hover:shadow-[0_0_12px_rgba(34,211,238,0.4)] hover:scale-105">
                    <Music size={14} className="transition-transform group-hover:scale-110" />
                    <span>非影视区</span>
                  </Link>
                  <Link href="/library" className="group flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/50 rounded-lg text-sm transition-all duration-200 text-violet-300 hover:shadow-[0_0_12px_rgba(167,139,250,0.4)] hover:scale-105">
                    <Library size={14} className="transition-transform group-hover:scale-110" />
                    <span>文档资源库</span>
                  </Link>
                  <Link href="/request" className="group flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500/20 to-pink-500/20 hover:from-amber-500/40 hover:to-pink-500/40 rounded-lg text-sm transition-all duration-200 text-amber-200 hover:shadow-[0_0_12px_rgba(245,158,11,0.4)] hover:scale-105 border border-amber-400/30">
                    <Sparkles size={14} className="transition-transform group-hover:scale-110" />
                    <span>求片专区</span>
                  </Link>
                  <button onClick={handleLogout} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition">退出</button>
                  <Link href="/activate" className="group flex items-center gap-1.5 px-3 py-1.5 bg-pink-600/30 hover:bg-pink-600/60 rounded-lg text-sm transition-all duration-200 text-pink-200 hover:shadow-[0_0_12px_rgba(236,72,153,0.4)] hover:scale-105">
                    <Gift size={14} className="transition-transform group-hover:scale-110" />
                    <span>兑换中心</span>
                  </Link>
                  {user?.group === 'admin' && (
                    <a href="/admin" className="group flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 rounded-lg text-sm font-medium transition-all duration-200 text-white hover:shadow-[0_0_12px_rgba(139,92,246,0.5)] hover:scale-105 border border-violet-400/40">
                      <Shield size={14} className="transition-transform group-hover:scale-110" />
                      <span>🎛️ 管理后台</span>
                    </a>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link href="/nonfilm" className="group flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/50 rounded-lg text-sm transition-all duration-200 text-cyan-300 hover:shadow-[0_0_12px_rgba(34,211,238,0.4)] hover:scale-105">
                    <Music size={14} className="transition-transform group-hover:scale-110" />
                    <span>非影视区</span>
                  </Link>
                  <Link href="/library" className="group flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/50 rounded-lg text-sm transition-all duration-200 text-violet-300 hover:shadow-[0_0_12px_rgba(167,139,250,0.4)] hover:scale-105">
                    <Library size={14} className="transition-transform group-hover:scale-110" />
                    <span>文档资源库</span>
                  </Link>
                  <Link href="/request" className="group flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500/20 to-pink-500/20 hover:from-amber-500/40 hover:to-pink-500/40 rounded-lg text-sm transition-all duration-200 text-amber-200 hover:shadow-[0_0_12px_rgba(245,158,11,0.4)] hover:scale-105 border border-amber-400/30">
                    <Sparkles size={14} className="transition-transform group-hover:scale-110" />
                    <span>求片专区</span>
                  </Link>
                  <Link href="/activate" className="group flex items-center gap-1.5 px-3 py-1.5 bg-pink-600/30 hover:bg-pink-600/60 rounded-lg text-sm transition-all duration-200 text-pink-200 hover:shadow-[0_0_12px_rgba(236,72,153,0.4)] hover:scale-105">
                    <Gift size={14} className="transition-transform group-hover:scale-110" />
                    <span>兑换中心</span>
                  </Link>
                  <Link href="/login" className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition">登录 / 注册</Link>
                </div>
              )}
            </div>
          </div>

          {/* Search - 2026-07-25 改: 玻璃态输入框 */}
          <div className="relative flex gap-2">
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchItems(1); }}
              placeholder="输入片名、类型、分类搜索..."
              className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-5 py-3 pl-12 text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/15 focus:bg-white/[0.05] transition backdrop-blur-sm" />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none">🔍</span>
            <button onClick={() => fetchItems(1)} className="px-5 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90 rounded-xl text-white font-medium transition shrink-0 shadow-[0_0_12px_rgba(168,85,247,0.2)]">搜索</button>
          </div>

          {/* 2026-07-20: 显示重复切换 + 按 TMDB 分组按钮 (搜出多条同名时显示) */}
          {groups.length > 1 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap text-sm">
              <span className="text-white/40">📚</span>
              <button
                onClick={() => setDedupBy(dedupBy === 'tmdb_id' ? 'id' : 'tmdb_id')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  dedupBy === 'id'
                    ? 'bg-amber-500/30 text-amber-200 ring-1 ring-amber-500/50'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
                title="切换是否按 TMDB 去重, 显示同名/同 TMDB 全部资源">
                {dedupBy === 'id' ? '📋 显示全部 (含重复)' : '🔀 合并去重'}
              </button>
              <span className="text-white/30 text-xs">·</span>
              <span className="text-white/40 text-xs">同 TMDB 分组:</span>
              {groups.slice(0, 8).map((g, i) => {
                // 提取标题 (去掉 " (2026) 4K..." 之类的后缀, 留主标题)
                const cleanName = g.name?.split(/\s*[\(【\[]/)[0]?.trim() || g.name || '(无标题)';
                const isCurrentPage = items.length > 0 && items[0]?.tmdbIdRaw === g.tmdbId && dedupBy === 'tmdb_id';
                return (
                  <button
                    key={i}
                    onClick={() => {
                      // 切到 'id' 模式 + 搜这个名字
                      setDedupBy('id');
                      setQuery(cleanName);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs transition ${
                      isCurrentPage
                        ? 'bg-violet-600 text-white'
                        : 'bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                    title={`TMDB: ${g.tmdbId || '无'}`}>
                    {cleanName.slice(0, 20)} <span className="opacity-60">({g.count})</span>
                  </button>
                );
              })}
              {groups.length > 8 && <span className="text-white/30 text-xs">+{groups.length - 8} 更多</span>}
            </div>
          )}

          {/* 2026-06-10: 新用户引导卡 - 仅未登录显示 */}
          {/* 2026-07-29: 邀请码 = basic, 不用再"激活", 2 步上手 */}
          {mounted && !user && (
            <div className="mt-3 bg-gradient-to-r from-violet-500/10 to-pink-500/10 border border-violet-500/30 rounded-xl p-4 flex items-center gap-3 flex-wrap">
              <div className="flex-shrink-0 text-3xl">🎬</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold mb-0.5">新人 2 步上手指南</div>
                <div className="text-xs text-white/60">① 邀请码注册即为基础会员，可浏览全站资源 ② 想要 VIP 资源可去闲鱼选套餐</div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Link href="/register" className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-medium whitespace-nowrap">1️⃣ 注册</Link>
                <Link href="/upgrade" className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-90 rounded-lg text-xs font-medium whitespace-nowrap">2️⃣ 闲鱼逛逛</Link>
              </div>
            </div>
          )}
          {/* 已登录但非 VIP - 引导开通 */}
          {mounted && user && !['vip', 'admin'].includes(user.group) && (
            <div className="mt-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-3 flex-wrap">
              <div className="text-2xl">⭐</div>
              <div className="flex-1 min-w-0 text-sm">升级 VIP 解锁 <b className="text-amber-300">VIP 影视资源</b> + <b className="text-pink-300">9大云盘非影视区</b></div>
              <Link href="/upgrade" className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg text-xs font-medium whitespace-nowrap">🛒 闲鱼选购</Link>
            </div>
          )}

          {/* Filter Bar - 2026-08-07 移除: 4 行筛选挪到下方"已匹配资源"模块里 (顶部只留搜索 + 入口, 不冻大块在头部影响观感) */}
        </div>
      </header>

      {/* 2026-08-04: 4ktop 风格首页模块 (Banner + 4 模块行) */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        {/* 1. 顶部 banner 轮播 */}
        <HomeBanner />

        {/* 1.5 2026-08-05 P11: TMDB 最新预告片区 (横幅下面) */}
        <TrailerRow />

        {/* 2. 最新上映模块 */}
        <div className="mt-6">
          <HomeSection
            title="最新上映"
            titleEn="NEW RELEASES"
            emoji="🎬"
            accent="cyan"
            href="/upcoming"
            items={secUpcoming}
            loading={secLoading}
          />
        </div>

        {/* 3. 免费专区 (115 链接, 泽泽妈文档改名) - 2026-08-07 */}
        <HomeSection
          title="免费专区"
          titleEn="FREE ZONE"
          emoji="🆓"
          accent="violet"
          href="/basic"
          items={secBasic}
          loading={secLoading}
        />

        {/* 4. VIP 多网盘 - 2026-08-08 改: 之前叫 "VIP专区" 跟 lovemovie 子域名 (VIP 在线影视) 撞名, 实际是 VIP 才有的多网盘资源 (百度/阿里/夸克/磁力/ed2k) */}
        <HomeSection
          title="VIP多网盘"
          titleEn="VIP MULTI-DRIVE"
          emoji="💎"
          accent="amber"
          href="/vip"
          items={secVip}
          loading={secLoading}
        />

        {/* 5. 主题专区 (横排卡片) */}
        {secThemes.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎯</span>
                <h2 className="text-base sm:text-lg font-bold text-emerald-300">
                  主题专区
                  <span className="ml-2 text-[10px] sm:text-xs text-white/40 font-normal tracking-wider uppercase">THEMES</span>
                </h2>
              </div>
              <Link href="/themes" className="flex items-center gap-0.5 text-xs text-white/50 hover:text-white transition">
                查看更多 <ChevronRight size={14} />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {secThemes.slice(0, 8).map((th, i) => (
                <motion.div
                  key={th.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <Link
                    href={`/themes/${th.id}`}
                    className="block p-3 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.04] to-teal-500/[0.04] hover:border-emerald-500/40 hover:from-emerald-500/[0.08] hover:to-teal-500/[0.08] transition group/th"
                  >
                    <div className="text-sm font-medium text-emerald-200 group-hover/th:text-emerald-100 line-clamp-1">
                      🎬 {th.name}
                    </div>
                    <div className="text-[10px] text-white/40 mt-1">
                      {th.item_count} 部资源
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 2026-08-07 P12: 已匹配资源模块 (从 header 挪下来的 4 行筛选 + SORT + 卡片列表) */}
      <main className="max-w-7xl mx-auto px-4 py-6 relative">
        {/* 模块标题 */}
        <div className="flex items-center justify-between mb-4 px-2">
          <h2 className="text-base sm:text-lg font-bold text-cyan-300">
            🗂️ 已匹配资源
            <span className="ml-2 text-[10px] sm:text-xs text-white/40 font-normal tracking-wider uppercase">MATCHED RESOURCES</span>
          </h2>
        </div>

        {/* 2026-08-07 从 header 挪过来: 4 行筛选 (分类/网盘/地区/年份) */}
        <div className="flex flex-col gap-1.5 mb-4 p-2 rounded-2xl bg-white/[0.02] border border-white/[0.04] backdrop-blur-sm">
          {/* 分类 */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
            {CATEGORIES.map((cat) => (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition shrink-0 ${category === cat
                  ? 'bg-gradient-to-r from-violet-500/25 to-fuchsia-500/25 text-white border border-violet-400/40 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                  : 'bg-white/[0.03] text-white/55 hover:text-white/85 hover:bg-white/[0.06] border border-transparent'}`}>{cat}</button>
            ))}
          </div>
          {/* 来源 */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
            {SOURCES.map((src) => (
              <button key={src} onClick={() => setSource(src)}
                className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${source === src
                  ? 'bg-gradient-to-r from-pink-500/25 to-rose-500/25 text-white border border-pink-400/40'
                  : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{src}</button>
            ))}
          </div>
          {/* 地区 */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
            <span className="text-[10px] text-white/30 self-center mr-0.5 shrink-0 tracking-wider">地区</span>
            {REGIONS.map((r) => (
              <button key={r} onClick={() => setRegion(r)}
                className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${region === r
                  ? 'bg-gradient-to-r from-orange-500/25 to-amber-500/25 text-white border border-orange-400/40'
                  : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{r}</button>
            ))}
          </div>
          {/* 年份 */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
            <span className="text-[10px] text-white/30 self-center mr-0.5 shrink-0 tracking-wider">年份</span>
            {YEARS.map((y) => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition shrink-0 ${year === y
                  ? 'bg-gradient-to-r from-cyan-500/25 to-teal-500/25 text-white border border-cyan-400/40'
                  : 'bg-white/[0.03] text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'}`}>{y}</button>
            ))}
          </div>
        </div>

        {/* Sort & Size Bar - 2026-07-25 改: 玻璃态 + 紫粉激活 */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5 px-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 tracking-wider uppercase">Sort</span>
            <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <button onClick={() => setSort('release_date')}
                className={`px-3 py-1 rounded-lg text-xs transition ${sort === 'release_date'
                  ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white shadow-[0_0_8px_rgba(168,85,247,0.2)]'
                  : 'text-white/50 hover:text-white/85'}`}>🎬 上映</button>
              <button onClick={() => setSort('added_time')}
                className={`px-3 py-1 rounded-lg text-xs transition ${sort === 'added_time'
                  ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white shadow-[0_0_8px_rgba(168,85,247,0.2)]'
                  : 'text-white/50 hover:text-white/85'}`}>📅 上架</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 hidden sm:inline tracking-wider uppercase">Per Page</span>
            <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              {[30, 90, 150].map((s) => (
                <button key={s} onClick={() => { latestRef.current = { ...latestRef.current, pageSize: s }; setPageSize(s); }}
                  className={`px-3 py-1 rounded-lg text-xs transition ${pageSize === s
                    ? 'bg-gradient-to-r from-pink-500/30 to-rose-500/30 text-white shadow-[0_0_8px_rgba(236,72,153,0.2)]'
                    : 'text-white/50 hover:text-white/85'}`}>{s}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
          {(() => {
            // 2026-06-03: 连载/剧集/动漫/综艺 按 category + tmdb_id 折叠
            // 显示最新一条 + "+N 集"徽章
            const groupableCats = ['连载', '剧集', '动漫', '综艺'];
            const seen = new Set<string>();
            const displayItems: Array<ResourceItem & { _extraCount?: number; _allIds?: number[]; _displayLinks?: any[] }> = [];
            for (const item of items) {
              if (item.tmdbId && groupableCats.includes(item.category)) {
                const key = `${item.category}:${item.tmdbId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                // 同 tmdb 同 category 的其他资源
                const group = items.filter(i =>
                  i.tmdbId === item.tmdbId && i.category === item.category
                );
                const extraCount = group.length - 1;
                const allIds = group.map(i => i.id);
                // 2026-07-27: 同 tmdb_id 的所有 link (前 8 个 source 优先级)
                const tmdbLinks = (item as any).tmdbLinks || [];
                const _displayLinks = tmdbLinks.length > 0 ? tmdbLinks : (item.links || []);
                displayItems.push({ ...item, _extraCount: extraCount, _allIds: allIds, _displayLinks });
              } else {
                // 2026-07-27: 同 tmdb_id 兜底
                const tmdbLinks = (item as any).tmdbLinks || [];
                const _displayLinks = tmdbLinks.length > 0 ? tmdbLinks : (item.links || []);
                displayItems.push({ ...item, _displayLinks });
              }
            }
            return displayItems;
          })().map((item) => {
            const extraCount = (item as any)._extraCount || 0;
            const allIds = (item as any)._allIds || [item.id];
            return (
            <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="group cursor-pointer rounded-2xl bg-white/[0.02] border border-white/[0.05] backdrop-blur-sm p-2 transition-all duration-300 hover:border-violet-400/40 hover:bg-white/[0.04] hover:shadow-[0_0_24px_rgba(168,85,247,0.12)]"
              onClick={() => handleItemClick(item)}
            >
              {/* Poster */}
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-2.5">
                {item.tmdb?.poster_path ? (
                  <img src={tmdbPoster(item.tmdb.poster_path, 'card')} alt={item.name}
                    className="w-full h-full object-cover transition group-hover:scale-105"
                    onError={(e) => { (e.target as HTMLImageElement).src = TMDB_FALLBACK; }}
                    loading="lazy" decoding="async" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-violet-900/30 to-pink-900/30">🎬</div>
                )}

                {/* Bottom Info Bar */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pt-6 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/80">{item.tmdb?.release_date?.slice(0, 4) || ''}</span>
                    {item.tmdb?.vote_average && (
                      <StarRating score={parseFloat(item.tmdb.vote_average)} />
                    )}
                  </div>
                </div>

                {/* Tags */}
                <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                  {item.tags?.slice(0, 2).map((tag) => (
                    <span key={tag} className="px-2 py-0.5 bg-violet-600/80 text-xs rounded">{tag}</span>
                  ))}
                  {/* 2026-06-03: 同 TMDB 多集徽章 */}
                  {extraCount > 0 && (
                    <span className="px-2 py-0.5 bg-amber-500/90 text-black text-xs rounded font-medium">
                      +{extraCount} 集
                    </span>
                  )}
                </div>

                {/* Source Badge */}
                <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                  {/* 2026-07-15 泽泽妈专属标识 (import_channel='zezemom_excel') - 修正: 实际值是 'zezemom_excel' 不是 'zezhe' */}
                  {isZezheChannel(item.importChannel) && (
                    <span className="px-2 py-0.5 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-xs rounded font-medium shadow-sm flex items-center gap-1">
                      <span>👑</span><span>泽泽妈</span>
                    </span>
                  )}
                  <span className="px-2 py-0.5 bg-pink-600/80 text-xs rounded">{cleanSource(item.source)}</span>
                  {/* 2026-07-15 修正: 资源 access_level='basic' 不一定都是泽泽妈 - 脏数据 (baidu/quark) 也被标了 basic
                      应该按 import_channel='zezemom_excel' 判定, 才是真泽泽妈文档 */}
                  {/* 2026-07-15 VIP 锁: basic 用户看非 zezhe 资源时显示锁 (前端展示, 不卡后端) */}
                  {user?.group === 'basic' && !isZezheChannel(item.importChannel) && item.accessLevel !== 'code' && (
                    <span className="px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-black text-xs rounded font-medium flex items-center gap-1">
                      <span>🔒</span><span>VIP 锁</span>
                    </span>
                  )}
                  {item.accessLevel === 'vip' && (
                    <span className="px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-black text-xs rounded font-medium">
                      👑 VIP
                    </span>
                  )}
                  {item.accessLevel === 'code' && (
                    <span className="px-2 py-0.5 bg-gradient-to-r from-yellow-500 to-amber-500 text-black text-xs rounded font-medium">
                      💎 单资源付费
                    </span>
                  )}
                  {isZezheChannel(item.importChannel) && (
                    <span className="px-2 py-0.5 bg-sky-500/30 border border-sky-500/40 text-sky-300 text-xs rounded">
                      📚 免费专区
                    </span>
                  )}
                  {/* 2026-06-03 单资源付费标记 */}
                  {item.payType === 'code' && !item.unlocked && (
                    <span className="px-2 py-0.5 bg-yellow-500/90 text-black text-xs rounded font-medium">
                      ¥{item.codePrice || 0} 解锁
                    </span>
                  )}
                  {item.payType === 'code' && item.unlocked && (
                    <span className="px-2 py-0.5 bg-green-500/90 text-white text-xs rounded font-medium">
                      ✓ 已解锁
                    </span>
                  )}
                  {item.payType === 'code' && (item.lumenCost ?? 1) > 0 && !item.unlocked && (
                    <span className="px-2 py-0.5 bg-violet-500/80 text-white text-xs rounded font-medium">
                      💎 {item.lumenCost ?? 1}
                    </span>
                  )}
                </div>

                {/* Overlay + Action */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                  {/* 2026-07-15 VIP 锁: basic 用户看非 zezhe 资源时, 中间按钮也禁用 */}
                  {isVipLocked(item) ? (
                    <button onClick={(e) => { e.stopPropagation(); addToast('error', '🔒 VIP 资源，basic 用户不可直接打开，请升级 VIP'); }}
                      className="px-4 py-2 bg-amber-600/80 rounded-lg text-sm font-medium flex items-center gap-1">
                      <span>🔒</span><span>升级 VIP 解锁</span>
                    </button>
                  ) : isMagnetOrEd2k(item.link) ? (
                    <button onClick={(e) => { e.stopPropagation(); handleCopyLink(item.link, e); }}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium">📋 复制链接</button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); handleDirectOpen(item.link, e); }}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium">🔗 打开</button>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="space-y-1 px-0.5">
                <h3 className="font-medium text-[13px] line-clamp-2 leading-tight text-white/90 group-hover:text-white transition">{item.name}</h3>
                <div className="flex items-center gap-2 text-[10px] text-white/40">
                  <span>{item.category}</span>
                  {item.size && <span>📦 {item.size}</span>}
                </div>
                {/* 2026-07-24: 1对N 多链接 - 卡片下网盘可点击图标 (按 sort 排序, 第一个高亮) */}
                {/* 2026-07-27: 用 _displayLinks (tmdbLinks 优先, 1对N 副表兜底) */}
                {/* 2026-07-29: 加 link 级别权限 - basic 用户只能开 zezhe link, 其他 link 锁住 */}
                {(item as any)._displayLinks && (item as any)._displayLinks.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap pt-0.5">
                    {(item as any)._displayLinks.slice(0, 8).map((l: any, idx: number) => {
                      const isMagnetLink = l.source === 'magnet' || l.source === 'ed2k';
                      // 2026-07-29: link 级别权限 - vip/admin 全开, basic 只开 zezhe link
                      const linkAllowed = (user?.group === 'vip' || user?.group === 'admin') ||
                        (l.accessLevel === 'code') ||  // 单资源付费 (流明解锁)
                        (l.importChannel === 'zezhe' || l.importChannel === 'zezemom_excel');
                      return (
                        <button
                          key={idx}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!linkAllowed) {
                              addCopyToast('🔒 VIP 渠道链接，basic 用户不可打开，请升级 VIP');
                              return;
                            }
                            if (isMagnetLink) handleCopyLink(l.url, e);
                            else handleDirectOpen(l.url, e);
                          }}
                          className={`px-1.5 py-0.5 text-[10px] rounded font-medium cursor-pointer transition-all hover:scale-105 ${
                            !linkAllowed
                              ? 'bg-white/5 text-white/30 border border-white/10 opacity-50 cursor-not-allowed'
                              : idx === 0
                              ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white border border-violet-400/50 ring-1 ring-violet-300/30'
                              : isMagnetLink
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : l.source === '115'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-white/5 text-white/60 border border-white/10'
                          }`}
                          title={!linkAllowed
                            ? `🔒 ${l.source} (VIP 渠道, 需升级 VIP 才能打开)`
                            : `${l.source}${l.password ? ` · 提取码: ${l.password}` : ''} · 点击${isMagnetLink ? '复制' : '打开'}`}
                        >
                          {!linkAllowed ? '🔒' :
                           l.source === 'magnet' || l.source === 'ed2k' ? '🧲' :
                           l.source === '115' ? '📦' :
                           l.source === 'baidu' ? '🅱️' :
                           l.source === 'quark' ? '🍊' :
                           l.source === 'aliyun' ? '☁️' :
                           l.source === 'xunlei' ? '⚡' :
                           l.source === '123' ? '1️⃣' :
                           l.source === 'uc' ? '🅿️' :
                           l.source === 'tianyi' ? '☂️' :
                           l.source === 'yidong' ? '📱' : '🔗'} {l.source}
                          {linkAllowed && idx === 0 && <span className="ml-0.5 text-[8px]">★</span>}
                        </button>
                      );
                    })}
                    {(item as any)._displayLinks.length > 8 && (
                      <span className="text-[10px] text-white/40">+{(item as any)._displayLinks.length - 8}</span>
                    )}
                    {/* 2026-07-24: 一键开全部 (>=2 个非磁力链接才显示) */}
                    {/* 2026-07-29: 只 basic 看 zezhe link + vip/admin 看全部. basic "开全部" 只开 zezhe */}
                    {(() => {
                      const allLinks = ((item as any)._displayLinks || []).filter((l: any) => l.source !== 'magnet' && l.source !== 'ed2k');
                      // basic 只看有权开 (zezhe), vip/admin 看全部
                      const allowedLinks = (user?.group === 'vip' || user?.group === 'admin')
                        ? allLinks
                        : allLinks.filter((l: any) => l.importChannel === 'zezhe' || l.importChannel === 'zezemom_excel' || l.accessLevel === 'code');
                      return allowedLinks.length >= 2 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // 依次 window.open (0.5s 间隔避开浏览器拦截)
                            allowedLinks.forEach((l: any, i: number) => {
                              setTimeout(() => {
                                if (l.password) {
                                  const ok = window.confirm(
                                    `🔗 ${l.source} 链接 (提取码: ${l.password})\n\n确定打开？`
                                  );
                                  if (ok) window.open(l.url, '_blank', 'noopener');
                                } else {
                                  window.open(l.url, '_blank', 'noopener');
                                }
                              }, i * 500);
                            });
                          }}
                          className="px-1.5 py-0.5 text-[10px] rounded font-medium cursor-pointer transition-all hover:scale-105 bg-gradient-to-r from-violet-500/40 to-fuchsia-500/40 text-white border border-violet-400/60 ring-1 ring-violet-300/40"
                          title={`一键打开所有允许的网盘链接 (${allowedLinks.length} 个)`}
                        >
                          🚀 开全部 ({allowedLinks.length})
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>
            </motion.div>
            );
          })}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex flex-col items-center gap-3 mt-8">
            {/* Page info */}
            <div className="text-xs text-white/40">
              共 {total.toLocaleString()} 条，第 {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} 页
            </div>
            {/* Page nav */}
            <div className="flex items-center gap-1 flex-wrap justify-center">
              <button onClick={() => fetchItems(1)} disabled={page === 1 || loading}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition">« 首页</button>
              <button onClick={() => fetchItems(page - 1)} disabled={page === 1 || loading}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition">‹ 上一页</button>

              {/* Page numbers */}
              {(() => {
                const totalPages = Math.ceil(total / pageSize);
                const pages: (number | string)[] = [];
                if (totalPages <= 7) {
                  for (let i = 1; i <= totalPages; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (page > 3) pages.push('...');
                  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
                  if (page < totalPages - 2) pages.push('...');
                  pages.push(totalPages);
                }
                return pages.map((p, idx) =>
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="px-1 text-white/30 text-xs">···</span>
                  ) : (
                    <button key={p} onClick={() => fetchItems(p as number)}
                      className={`w-9 h-9 rounded-lg text-xs font-medium transition ${page === p ? 'bg-violet-600 text-white' : 'bg-white/5 hover:bg-white/10 text-white/60'}`}>{p}</button>
                  )
                );
              })()}

              <button onClick={() => fetchItems(page + 1)} disabled={page >= Math.ceil(total / pageSize) || loading}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition">下一页 ›</button>
              <button onClick={() => fetchItems(Math.ceil(total / pageSize))} disabled={page >= Math.ceil(total / pageSize) || loading}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition">末页 »</button>
            </div>

            {/* Mobile page select */}
            <div className="sm:hidden flex items-center gap-2">
              <span className="text-xs text-white/40">跳至</span>
              <select value={page} onChange={(e) => fetchItems(parseInt(e.target.value))}
                className="bg-white/10 border border-white/10 text-white text-xs rounded-lg px-2 py-1.5">
                {Array.from({ length: Math.ceil(total / pageSize) }, (_, i) => i + 1).map((p) => (
                  <option key={p} value={p}>第 {p} 页</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </main>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setSelectedItem(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#12121a] rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-col md:flex-row">
                <div className="w-full md:w-80 shrink-0">
                  <div className="aspect-[2/3] bg-white/5">
                    {selectedItem.tmdb?.poster_path ? (
                      <img src={tmdbPoster(selectedItem.tmdb.poster_path, 'large')} alt={selectedItem.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-6xl">🎬</div>
                    )}
                  </div>
                </div>
                <div className="flex-1 p-6 overflow-y-auto max-h-[70vh]">
                  {/* Title + Close */}
                  <div className="flex items-start justify-between mb-5">
                    <h2 className="text-xl font-bold leading-tight pr-4">{selectedItem.name}</h2>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setSelectedItem(null)} className="p-1.5 hover:bg-white/10 rounded-lg transition text-white/40 hover:text-white">✕</button>
                    </div>
                  </div>
                  {/* 2026-07-31: admin 顶部 banner 已移除 (用户选 3 = 折叠到右上"管理员选项"), 整资源操作移到下方折叠区 */}

                  {/* ── TMDB Info Section ── */}
                  {selectedItem.tmdb && (
                    <div className="mb-5 space-y-4">
                      {/* Tagline */}
                      {tmdbCredits?.tagline && (
                        <p className="text-sm italic text-amber-400/80">"{tmdbCredits.tagline}"</p>
                      )}

                      {/* Rating row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        {selectedItem.tmdb.vote_average && (
                          <>
                            <div className="flex items-center gap-1">
                              <span className="text-2xl font-bold text-yellow-400">{parseFloat(selectedItem.tmdb.vote_average).toFixed(1)}</span>
                              <span className="text-white/30 text-sm">/ 10</span>
                            </div>
                            <StarRating score={parseFloat(selectedItem.tmdb.vote_average)} />
                            {(tmdbCredits?.vote_count ?? 0) > 0 && (
                              <span className="text-xs text-white/30">{(tmdbCredits?.vote_count ?? 0).toLocaleString()} 人评分</span>
                            )}
                          </>
                        )}
                        {selectedItem.tmdb.release_date && (
                          <span className="text-sm text-white/50">📅 {selectedItem.tmdb.release_date}</span>
                        )}
                        {tmdbCredits?.original_title && tmdbCredits.original_title !== selectedItem.name && (
                          <span className="text-sm text-white/30 italic">{tmdbCredits.original_title}</span>
                        )}
                      </div>

                      {/* Genres */}
{(tmdbCredits && (tmdbCredits.genres?.length ?? 0) > 0) && (
                          <div className="flex flex-wrap gap-1.5">
                            {tmdbCredits.genres.map((g) => (
                            <span key={g} className="px-2.5 py-1 bg-violet-600/30 text-violet-300 text-xs rounded-full border border-violet-500/20">{g}</span>
                          ))}
                        </div>
                      )}

                      {/* Director */}
                      {tmdbCredits && tmdbCredits.director?.length > 0 && (
                        <div>
                          <div className="text-xs text-white/40 mb-2">🎬 导演</div>
                          <div className="flex gap-3 overflow-x-auto scrollbar-hide">
                            {tmdbCredits.director.map((d, i) => (
                              <div key={i} className="flex flex-col items-center shrink-0 w-16">
                                <div className="w-12 h-12 rounded-full bg-white/10 overflow-hidden mb-1 flex items-center justify-center text-lg">
                                  {d.profile_path ? <img src={d.profile_path} alt={d.name} className="w-full h-full object-cover" /> : '🎬'}
                                </div>
                                <span className="text-xs text-white/70 text-center leading-tight truncate w-full">{d.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Cast */}
                      {tmdbCredits && tmdbCredits.cast?.length > 0 && (
                        <div>
                          <div className="text-xs text-white/40 mb-2">🎭 演员</div>
                          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                            {tmdbCredits.cast.slice(0, 15).map((c, i) => (
                              <div key={i} className="flex flex-col items-center shrink-0 w-16">
                                <div className="w-12 h-12 rounded-full bg-white/10 overflow-hidden mb-1 flex items-center justify-center text-lg">
                                  {c.profile_path ? <img src={c.profile_path} alt={c.name} className="w-full h-full object-cover" loading="lazy" decoding="async" /> : '👤'}
                                </div>
                                <span className="text-xs text-white/70 text-center leading-tight truncate w-full">{c.name}</span>
                                {c.character && <span className="text-xs text-white/30 text-center truncate w-full">{c.character}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Synopsis */}
                      {tmdbCredits?.overview && (
                        <div>
                          <div className="text-xs text-white/40 mb-1.5">📖 简介</div>
                          <p className="text-sm text-white/60 leading-relaxed">{tmdbCredits.overview}</p>
                        </div>
                      )}

                      {/* Basic info row */}
                      <div className="flex flex-wrap gap-2 text-sm">
                        <span className="px-2 py-1 bg-violet-600/30 rounded text-violet-300">{selectedItem.category}</span>
                        <span className="px-2 py-1 bg-pink-600/30 rounded text-pink-300">{cleanSource(selectedItem.source)}</span>
                        {selectedItem.type && <span className="px-2 py-1 bg-white/10 rounded text-white/60">{selectedItem.type}</span>}
                        {selectedItem.size && <span className="px-2 py-1 bg-white/10 rounded text-white/50">📦 {selectedItem.size}</span>}
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-base text-white/80">
                        📎 资源链接{(() => {
                          const count = selectedItem.tmdbLinks?.length || selectedItem.links?.length || 0;
                          return count > 0 ? <span className="ml-2 text-xs text-white/40">({count})</span> : null;
                        })()}
                      </h3>
                      {isAdmin && (selectedItem.tmdbLinks?.length || 0) > 0 && (
                        <details className="relative text-xs">
                          <summary className="px-2 py-1 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-400/30 rounded text-violet-200 cursor-pointer list-none">⚙️ 管理员选项 ({selectedItem.tmdbLinks?.length})</summary>
                          <div className="absolute right-0 top-full mt-1 bg-[#12121a] border border-white/10 rounded-lg p-2 z-20 min-w-[280px] max-h-[60vh] overflow-y-auto shadow-xl">
                            <button onClick={async () => {
                              if (!confirm(`确认把当前资源所有 link 标记为软删?\n资源 ID: ${selectedItem.id}\n名称: ${selectedItem.name}`)) return;
                              const token = getToken();
                              if (!token) { addToast('error', '❌ 未登录或 token 失效'); return; }
                              const r = await fetch(`/api/admin/resources/${selectedItem.id}?hard=false`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
                              });
                              const d = await r.json();
                              if (d.ok) { addToast('success', '🗑️ 资源已软删'); setSelectedItem(null); fetchItems(1); }
                              else addToast('error', `❌ ${d.error || '失败'}`);
                            }} className="w-full text-left text-xs px-2 py-1 hover:bg-white/10 rounded text-amber-300">🗑️ 软删整个资源</button>
                            <button onClick={async () => {
                              if (!confirm(`硬删? 这个会真的从 DB 删!\n资源 ID: ${selectedItem.id}`)) return;
                              if (!confirm(`🔥 真的硬删? 不可恢复!`)) return;
                              const hardConfirm = prompt(`输入资源 ID ${selectedItem.id} 确认硬删:`);
                              if (hardConfirm !== String(selectedItem.id)) { addToast('error', '❌ 已取消'); return; }
                              const token = getToken();
                              if (!token) { addToast('error', '❌ 未登录或 token 失效'); return; }
                              const r = await fetch(`/api/admin/resources/${selectedItem.id}?hard=true`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
                              });
                              const d = await r.json();
                              if (d.ok) { addToast('success', '💀 硬删成功'); setSelectedItem(null); fetchItems(1); }
                              else addToast('error', `❌ ${d.error || '失败'}`);
                            }} className="w-full text-left text-xs px-2 py-1 hover:bg-white/10 rounded text-red-300">💀 硬删资源 (不可恢复)</button>
                            <div className="text-xs text-white/40 mt-2 mb-1 px-1 border-t border-white/10 pt-2">📎 按 link 改/删 ({selectedItem.tmdbLinks?.length})</div>
                            <div className="space-y-0.5">
                              {(selectedItem.tmdbLinks || []).map((l: any) => (
                                <div key={`admin-${l.id}-${l.source}`} className="flex items-center gap-1 px-1 py-0.5 hover:bg-white/5 rounded text-[10px]">
                                  <span className="truncate flex-1 min-w-0" title={l.resourceName || l.url || ''}>
                                    {l.source} #{l.id} {l.size ? `· ${l.size}` : ''}
                                  </span>
                                  <button onClick={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const newUrl = prompt(`改 URL:\n(${l.source} #${l.id})`, l.url);
                                    if (!newUrl || newUrl === l.url) return;
                                    const token = getToken();
                                    if (!token) { addToast('error', '❌ 未登录'); return; }
                                    const r = await fetch('/api/admin/links', {
                                      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                                      body: JSON.stringify({ resourceId: l.id, source: l.source, url: newUrl, password: l.password })
                                    });
                                    const d = await r.json();
                                    if (d.ok) {
                                      addToast('success', '✅ 已更新');
                                      setSelectedItem(prev => prev ? { ...prev, tmdbLinks: prev.tmdbLinks?.map(x => x.id === l.id && x.source === l.source ? { ...x, url: newUrl } : x) } : prev);
                                      setTimeout(() => fetchItems(1), 500);
                                    } else addToast('error', `❌ ${r.status} ${d.error || '更新失败'}`);
                                  }} className="px-1 hover:bg-white/10 rounded text-white/60 hover:text-white shrink-0" title="改 URL">✏️</button>
                                  <button onClick={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (!confirm(`删除 ${l.source} link?\n资源 ID: ${l.id}`)) return;
                                    const token = getToken();
                                    if (!token) { addToast('error', '❌ 未登录'); return; }
                                    const r = await fetch('/api/admin/links', {
                                      method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                                      body: JSON.stringify({ resourceId: l.id, source: l.source })
                                    });
                                    const d = await r.json();
                                    if (d.ok) {
                                      addToast('success', '🗑️ 已删除');
                                      setSelectedItem(prev => prev ? { ...prev, tmdbLinks: prev.tmdbLinks?.filter(x => !(x.id === l.id && x.source === l.source)) } : prev);
                                      setTimeout(() => fetchItems(1), 500);
                                    } else addToast('error', `❌ ${r.status} ${d.error || '删除失败'}`);
                                  }} className="px-1 hover:bg-red-500/20 rounded text-red-300 hover:text-red-200 shrink-0" title="删 link">🗑️</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </details>
                      )}
                    </div>
                    {(() => {
                      // 2026-07-31: 用 tmdbLinks (同剧所有 link) 替代 links (单资源)
                      const allLinks: any[] = (selectedItem.tmdbLinks && selectedItem.tmdbLinks.length > 0)
                        ? selectedItem.tmdbLinks
                        : (selectedItem.links || []).map((l: any) => ({ ...l, resourceName: selectedItem.name, size: selectedItem.size, createdAt: '' }));
                      if (allLinks.length === 0) {
                        return (
                          <div className="px-4 py-6 rounded-xl bg-white/5 text-white/40 text-center text-sm">
                            暂无播放链接, 等待匹配脚本
                          </div>
                        );
                      }
                      const SOURCE_DISPLAY: Record<string, string> = {
                        '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
                        'aliyun': '阿里云盘', 'xunlei': '迅雷网盘', '123': '123网盘',
                        'uc': 'UC网盘', 'tianyi': '天翼云盘', 'yidong': '移动云盘',
                      };
                      const SOURCE_ICON: Record<string, string> = {
                        '115': '📦', 'baidu': '🅱️', 'quark': '🍊', 'aliyun': '☁️',
                        'xunlei': '⚡', '123': '1️⃣', 'uc': '🅿️', 'tianyi': '☂️', 'yidong': '📱',
                      };
                      // 按 source 分组
                      const netdiskGroups = new Map<string, any[]>();
                      const magnetLinks: any[] = [];
                      const ed2kLinks: any[] = [];
                      for (const l of allLinks) {
                        const src = l.source;
                        if (src === 'magnet' || src === '磁力链接') magnetLinks.push(l);
                        else if (src === 'ed2k' || src === 'ed2k链接') ed2kLinks.push(l);
                        else {
                          if (!netdiskGroups.has(src)) netdiskGroups.set(src, []);
                          netdiskGroups.get(src)!.push(l);
                        }
                      }
                      // 渲染一个 link 卡片 (admin 改/删根据用户选择, 折叠到右上"管理员选项"下, 这里不放)
                      const renderLinkCard = (l: any, isMagnet: boolean) => {
                        const src = l.source;
                        const icon = isMagnet ? (src === 'ed2k' || src === 'ed2k链接' ? '📎' : '🧲') : (SOURCE_ICON[src] || '🔗');
                        const sourceName = isMagnet ? (src === 'ed2k' || src === 'ed2k链接' ? 'ED2K 链接' : '磁力链接') : (SOURCE_DISPLAY[src] || src);
                        // 2026-07-31: link 级别鉴权 - 跟卡片版一致 (basic 用户只看 zezhe 渠道 link)
                        const linkAllowed = isAdmin
                          || user?.group === 'vip'
                          || l.accessLevel === 'code'  // 单资源付费 (流明解锁)
                          || isZezheChannel(l.importChannel);
                        // 提取 resource 名字 [xxx] 标签
                        let nameLabel = '';
                        if (l.resourceName) {
                          const m = l.resourceName.match(/\[([^\]]+)\]/g);
                          if (m) nameLabel = m.join(' ').replace(/\[/g, '').replace(/\]/g, '');
                        }
                        return (
                          <div key={`${src}-${l.id}-${(l.url || '').slice(0, 30)}`}>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                if (!linkAllowed) {
                                  addCopyToast('🔒 VIP 渠道链接，basic 用户不可打开，请升级 VIP');
                                  return;
                                }
                                isMagnet ? handleCopyLink(l.url, e) : handleDirectOpen(l.url, e);
                              }}
                              className={`w-full flex items-center justify-between p-3 sm:p-4 rounded-xl transition group text-left ${
                                linkAllowed ? 'bg-white/5 hover:bg-white/10' : 'bg-white/[0.02] opacity-60 cursor-not-allowed'
                              }`}
                            >
                              <span className="flex items-center gap-3 min-w-0 flex-1">
                                <span className="text-xl shrink-0">{linkAllowed ? icon : '🔒'}</span>
                                <span className="min-w-0 flex-1">
                                  <span className="font-medium flex items-center gap-2 flex-wrap">
                                    <span>{sourceName}</span>
                                    {nameLabel && <span className="text-xs px-1.5 py-0.5 bg-violet-500/20 text-violet-200 rounded">{nameLabel}</span>}
                                    {l.size && <span className="text-xs text-white/40">📦 {l.size}</span>}
                                    {!linkAllowed && <span className="text-xs px-1.5 py-0.5 bg-amber-500/30 text-amber-200 rounded">VIP</span>}
                                  </span>
                                  <span className="block text-xs text-white/50 truncate mt-0.5">
                                    {isMagnet
                                      ? <span className="text-cyan-400">{(l.url || '').slice(0, 60)}...</span>
                                      : (l.password ? `提取码：${l.password}` : '无需提取码')}
                                  </span>
                                </span>
                              </span>
                              <span className={`px-2.5 py-1 rounded-lg text-sm shrink-0 ${linkAllowed ? 'opacity-0 group-hover:opacity-100 ' : ''}${isMagnet ? 'bg-cyan-600' : 'bg-violet-600'}`}>
                                {linkAllowed ? (isMagnet ? '📋 复制' : '🔗 打开') : '🔒 VIP'}
                              </span>
                            </button>
                            {/* 2026-07-31: admin 改/删按钮已合并到右上"管理员选项"折叠区, 这里不再 inline */}
                            {!isAdmin && user && linkAllowed && (
                              <button onClick={async (e) => {
                                e.preventDefault();
                                const reason = prompt('反馈原因 (失效/限速/密码错/内容错/其他):', '失效');
                                if (!reason) return;
                                const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() }, body: JSON.stringify({ resourceId: l.id, source: src, reason }) });
                                const d = await r.json();
                                if (d.ok) addToast('success', '✅ 反馈已提交');
                              }} className="text-xs ml-11 mt-1 px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 rounded">⚠️ 失效反馈</button>
                            )}
                          </div>
                        );
                      };
                      // 渲染分组
                      return (
                        <div className="space-y-4">
                          {Array.from(netdiskGroups.entries()).map(([src, links]) => (
                            <div key={src} className="space-y-2">
                              <div className="text-xs text-white/60 font-medium px-1">
                                {SOURCE_ICON[src] || '🔗'} {SOURCE_DISPLAY[src] || src} <span className="text-white/30">({links.length})</span>
                              </div>
                              {links.map((l) => renderLinkCard(l, false))}
                            </div>
                          ))}
                          {magnetLinks.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs text-white/60 font-medium px-1">🧲 磁力链接 <span className="text-white/30">({magnetLinks.length})</span></div>
                              {magnetLinks.map((l) => renderLinkCard(l, true))}
                            </div>
                          )}
                          {ed2kLinks.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs text-white/60 font-medium px-1">📎 ED2K 链接 <span className="text-white/30">({ed2kLinks.length})</span></div>
                              {ed2kLinks.map((l) => renderLinkCard(l, true))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                      {/* 2026-06-03 单资源付费 - 解锁按钮 */}
                      {selectedItem.payType === 'code' && !selectedItem.unlocked && (
                        <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-yellow-300">🔒 此资源需要激活码 / 流明</div>
                              <div className="text-xs text-white/60 mt-1">¥{selectedItem.codePrice || 0} · 💎 {selectedItem.lumenCost ?? 1} 流明 · VIP 才能流明解锁</div>
                            </div>
                            <button onClick={() => openUnlock(selectedItem)}
                              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm font-medium shrink-0">
                              解锁
                            </button>
                          </div>
                          <div className="text-xs text-white/40 mt-2">购买联系：HK 麦盘人微信 / 支付宝扫码</div>
                        </div>
                      )}
                      {selectedItem.payType === 'code' && selectedItem.unlocked && (
                        <div className="mt-3 p-2 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-300 flex items-center gap-2">
                          ✓ 您已解锁此资源
                        </div>
                      )}

                    {relatedItems.length > 0 && tmdbType === 'tv' ? (
                      <div className="space-y-2">
                        {(() => {
                          const current = relatedItems.filter(r => r.isCurrent !== false);
                          return (
                            <>
                              <div className="text-xs text-white/40 mb-1">📌 当前版本（共 {current.length} 个）</div>
                              {current.map((rel) => (
                                <div key={rel.id}>
                                  {isMagnetOrEd2k(rel.link) ? (
                                    <button onClick={(e) => { e.preventDefault(); handleCopyLink(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-violet-600/10 hover:bg-violet-600/20 rounded-lg transition text-left">
                                      <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-violet-600/30 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate">{rel.name}</span></div>
                                      <span className="text-cyan-400 text-xs shrink-0 ml-2">📋 复制</span>
                                    </button>
                                  ) : (
                                    <button onClick={(e) => { e.preventDefault(); handleDirectOpen(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-violet-600/10 hover:bg-violet-600/20 rounded-lg transition text-left">
                                      <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-violet-600/30 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate">{rel.name}</span></div>
                                      <span className="text-violet-400 text-xs shrink-0 ml-2">🔗 打开</span>
                                    </button>
                                  )}
                                </div>
                              ))}
                            </>
                          );
                        })()}
                        {(() => {
                          const history = relatedItems.filter(r => r.isCurrent === false);
                          if (history.length === 0) return null;
                          return (
                            <>
                              <button onClick={() => setHistoryExpanded(!historyExpanded)} className="w-full flex items-center justify-between p-2 text-xs text-white/40 hover:text-white/60 transition">
                                <span>📦 历史版本（共 {history.length} 个）</span><span>{historyExpanded ? '▲ 收起' : '▼ 展开'}</span>
                              </button>
                              {historyExpanded && history.map((rel) => (
                                <div key={rel.id} className="opacity-60">
                                  {isMagnetOrEd2k(rel.link) ? (
                                    <button onClick={(e) => { e.preventDefault(); handleCopyLink(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left">
                                      <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-white/20 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate line-through">{rel.name}</span></div>
                                      <span className="text-white/40 text-xs shrink-0 ml-2">📋 复制</span>
                                    </button>
                                  ) : (
                                    <button onClick={(e) => { e.preventDefault(); handleDirectOpen(rel.link, e); }}
                                      className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left">
                                      <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-white/20 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate line-through">{rel.name}</span></div>
                                      <span className="text-white/60 text-xs shrink-0 ml-2">🔗 打开</span>
                                    </button>
                                  )}
                                </div>
                              ))}
                            </>
                          );
                        })()}
                      </div>
                    ) : relatedItems.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-xs text-white/40 mb-1">📦 其他版本（共 {relatedItems.length} 个）</div>
                        {relatedItems.map((rel) => (
                          isMagnetOrEd2k(rel.link) ? (
                            <button key={rel.id} onClick={(e) => { e.preventDefault(); handleCopyLink(rel.link, e); }}
                              className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left">
                              <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-cyan-600/30 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate">{rel.name}</span></div>
                              <span className="text-cyan-400 text-xs shrink-0 ml-2">📋 复制</span>
                            </button>
                          ) : (
                            <button key={rel.id} onClick={(e) => { e.preventDefault(); handleDirectOpen(rel.link, e); }}
                              className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition text-left">
                              <div className="flex items-center gap-2 min-w-0"><span className="px-2 py-0.5 bg-pink-600/30 rounded text-xs shrink-0">{rel.source}</span><span className="text-sm truncate">{rel.name}</span></div>
                              <span className="text-pink-400 text-xs shrink-0 ml-2">🔗 打开</span>
                            </button>
                          )
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {selectedItem.tags?.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm text-white/60 mb-2">标签：</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedItem.tags.map((tag) => (<span key={tag} className="px-3 py-1 bg-white/10 rounded-full text-sm">{tag}</span>))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Download Toasts */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {downloadToasts.map((toast) => (
            <motion.div key={toast.id} initial={{ opacity: 0, x: 80, scale: 0.8 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 80, scale: 0.8 }}
              className={`px-5 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 min-w-[220px] ${toast.type === 'success' ? 'bg-green-600/90 text-white' : toast.type === 'cooldown' ? 'bg-orange-600/90 text-white' : toast.type === 'limit' ? 'bg-blue-600/90 text-white' : toast.type === 'banned' ? 'bg-red-700/90 text-white' : toast.type === 'warning' ? 'bg-amber-500/90 text-black' : 'bg-red-600/90 text-white'}`}>
              <span>{toast.type === 'success' ? '✓' : toast.type === 'cooldown' ? '⏳' : toast.type === 'limit' ? '📊' : toast.type === 'banned' ? '🚫' : toast.type === 'warning' ? '⚠️' : '✕'}</span>
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Copy Toasts */}
      <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {copyToasts.map((toast) => (
            <motion.div key={toast.id} initial={{ opacity: 0, x: -80, scale: 0.8 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -80, scale: 0.8 }}
              className="px-5 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 min-w-[180px] bg-cyan-600/90 text-white">
              📋 {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 2026-06-03 单资源付费 unlock 弹窗 */}
      {unlockItem && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[60]"
          onClick={() => !unlockLoading && setUnlockItem(null)}>
          <div className="bg-[#12121a] rounded-2xl p-6 w-full max-w-md border border-yellow-500/30"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🔒</span>
              <h3 className="text-lg font-semibold">解锁资源</h3>
              <button onClick={() => !unlockLoading && setUnlockItem(null)}
                className="ml-auto p-1 hover:bg-white/10 rounded text-white/40 hover:text-white">✕</button>
            </div>
            <div className="mb-4">
              <div className="text-sm text-white/80 font-medium truncate">{unlockItem.name}</div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 rounded text-xs">付费资源</span>
                <span className="text-yellow-300 font-bold">¥{unlockItem.codePrice || 0}</span>
                <span className="px-2 py-0.5 bg-violet-500/20 text-violet-300 rounded text-xs">💎 {unlockItem.lumenCost ?? 1} 流明</span>
                <span className="text-xs text-white/40">{unlockItem.category} · #{unlockItem.id}</span>
              </div>
              <div className="mt-3 px-3 py-2 bg-violet-500/10 border border-violet-500/20 rounded-lg flex items-center justify-between">
                <span className="text-xs text-white/60">💎 我的流明余额</span>
                <span className="text-violet-300 font-bold">{lumenBalance}</span>
              </div>
            </div>
            <div className="flex border-b border-white/10 mb-3">
              <button onClick={() => { setUnlockMode('lumen'); setUnlockError(''); }}
                className={`px-4 py-2 text-sm ${unlockMode === 'lumen' ? 'text-violet-300 border-b-2 border-violet-400' : 'text-white/40'}`}>
                💎 流明解锁
              </button>
              <button onClick={() => { setUnlockMode('code'); setUnlockError(''); }}
                className={`px-4 py-2 text-sm ${unlockMode === 'code' ? 'text-yellow-300 border-b-2 border-yellow-400' : 'text-white/40'}`}>
                🎫 激活码解锁
              </button>
            </div>
            <div className="space-y-3">
              {unlockMode === 'code' && (
                <div>
                  <label className="block text-sm text-white/60 mb-1.5">激活码（8 位大小写字母数字）</label>
                  <input
                    value={unlockCode}
                    onChange={e => setUnlockCode(e.target.value.toUpperCase().slice(0, 8))}
                    onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                    placeholder="如 A3B7X9K2"
                    maxLength={8}
                    className="w-full bg-black/40 border border-white/20 rounded-lg px-4 py-3 text-white font-mono text-lg tracking-widest uppercase placeholder-white/20"
                    autoFocus
                    disabled={unlockLoading}
                  />
                </div>
              )}
              {unlockMode === 'lumen' && (
                <div className="px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white/70">
                  <div className="flex justify-between mb-1"><span>消耗流明：</span><span className="text-violet-300 font-bold">{unlockItem.lumenCost ?? 1}</span></div>
                  <div className="flex justify-between mb-1"><span>解锁后余额：</span><span className="text-white/80">{Math.max(0, lumenBalance - (unlockItem.lumenCost ?? 1))}</span></div>
                  <div className="text-xs text-white/40 mt-1">需要 VIP 会员资格 + 足够流明</div>
                </div>
              )}
              {unlockError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  ✕ {unlockError}
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setUnlockItem(null)} disabled={unlockLoading}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm disabled:opacity-30">取消</button>
              <button onClick={handleUnlock} disabled={unlockLoading || (unlockMode === 'code' && unlockCode.length !== 8)}
                className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-30 ${unlockMode === 'lumen' ? 'bg-violet-600 hover:bg-violet-500' : 'bg-yellow-600 hover:bg-yellow-500'}`}>
                {unlockLoading ? '解锁中...' : (unlockMode === 'lumen' ? '💎 流明解锁' : '🔓 解锁')}
              </button>
            </div>
            <div className="mt-4 text-xs text-white/40 text-center">
              没流明？<Link href="/activate" className="text-violet-300 hover:underline">兑换流明码</Link> · 需要激活码？<Link href="/activate" className="text-yellow-300 hover:underline">兑换 VIP 码</Link>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
