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
  sourceDisplay?: string;
  displayCategory?: string;
  createdAt?: string;
  isMultiLink?: boolean;
  links?: Array<{ source: string; url: string; password: string; sort: number; accessLevel?: string; status?: string }>;  // 2026-07-24 多链接
}
interface CategoryBtn {
  name: string;
  key: string;
  count: number;
}

// 3 大区 (2026-07-27 用户拍板: 不要单独"待归类"区, 待归类作为 vip 区按网盘的分类按钮)
// 硬规则: zezhe (basic 直接看) / vip (vip 会员才能看) / code (单资源付费)
const SECTIONS = [
  { key: 'zezhe', label: '泽泽妈妈115文档', icon: '👑', desc: 'basic 会员可以直接打开' },
  { key: 'vip', label: 'VIP 区', icon: '🔒', desc: 'VIP 会员可直接打开，basic 显示 VIP 锁 (含"待归类"网盘按钮)' },
  { key: 'code', label: '单独付费区', icon: '💎', desc: '需消耗流明解锁 (admin 免流明)' },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];

const SECTION_COLOR: Record<SectionKey, string> = {
  zezhe: 'from-pink-500/20 to-purple-500/20 border-pink-500/40',
  vip: 'from-amber-500/20 to-orange-500/20 border-amber-500/40',
  code: 'from-cyan-500/20 to-blue-500/20 border-cyan-500/40',
};

// 2026-10-22 UI 重做: 暗色主题 (跟首页 / 影视区统一)
//   - 原来是亮色 bg-gray-50 + 白卡片, 跟站内暗色完全不搭, 看着很丑
const SECTION_BADGE: Record<SectionKey, string> = {
  zezhe: 'bg-gradient-to-r from-pink-500 to-purple-500 text-white',
  vip: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white',
  code: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white',
};

// 2026-10-22: 3 大区 Tab 的暗色激活态
const SECTION_TAB_ACTIVE: Record<SectionKey, string> = {
  zezhe: 'bg-gradient-to-r from-pink-500/25 to-purple-500/25 border-pink-400/50 text-white shadow-lg shadow-pink-500/10',
  vip: 'bg-gradient-to-r from-amber-500/25 to-orange-500/25 border-amber-400/50 text-white shadow-lg shadow-amber-500/10',
  code: 'bg-gradient-to-r from-cyan-500/25 to-blue-500/25 border-cyan-400/50 text-white shadow-lg shadow-cyan-500/10',
};

// 2026-10-22: 分类按钮激活态 (暗色)
const SECTION_CHIP_ACTIVE: Record<SectionKey, string> = {
  zezhe: 'bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-md shadow-pink-500/20 border-transparent',
  vip: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20 border-transparent',
  code: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-md shadow-cyan-500/20 border-transparent',
};

const CATEGORY_ICONS: Record<string, string> = {
  '电影': '🎬', '剧集': '📺', '动漫': '🈴', '纪录片': '📽️',
  '综艺': '🎭', '演唱会': '🎤', '连载': '🆕',
  '原盘': '💿', 'REMUX': '🔧', '系列电影': '🎞️',
  '合集': '📦', '音乐': '🎵', '体育': '⚽', '少儿频道': '🧒',
  '电子书': '📚', '精品课': '🎓', '文档': '📄',
};

// ISO → "2026-01-15 12:34"
function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 10);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return iso.slice(0, 10);
  }
}

export default function LibraryPage() {
  const router = useRouter();
  const [userGroup, setUserGroup] = useState<string>('user');
  const [userId, setUserId] = useState<string>('');
  const [userName, setUserName] = useState<string>('');  // 2026-08-17: 顶部入口显示
  // 2026-10-15: 从 URL ?section= 读取初始 section (首页"查看更多"跳过来保持一致)
  const [section, setSection] = useState<SectionKey>(() => {
    if (typeof window !== 'undefined') {
      const s = new URLSearchParams(window.location.search).get('section');
      if (s === 'vip' || s === 'code' || s === 'zezhe') return s;
    }
    return 'zezhe';
  });
  // 分类: zezhe 用 sheet, vip/code 用 source
  const [subCategory, setSubCategory] = useState<string>('');
  const [categories, setCategories] = useState<CategoryBtn[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'asc' | 'desc'>('desc');  // desc=按添加时间倒序 (默认)
  const [items, setItems] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [unlocking, setUnlocking] = useState<Set<number>>(new Set());
  const [lumenBalance, setLumenBalance] = useState(0);
  const [pointsBalance, setPointsBalance] = useState(0);  // 2026-10-15: basic 5 积分解锁 vip 资源
  const [lumenModal, setLumenModal] = useState<{ cost: number; balance: number; resourceName: string; creditAvailable?: number; resourceId?: number } | null>(null);
  const [upgradeModal, setUpgradeModal] = useState(false);  // 2026-08-17: VIP 购买弹框 (iframe /upgrade)
  let toastCnt = 0;

  // 读 user 组
  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u?.group) setUserGroup(u.group);
      if (u?.id) setUserId(String(u.id));
      if (u?.username) setUserName(u.username);
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

  // 业务逻辑 (2026-07-25 硬规则版, 2026-07-27 简化为 3 大区)
  // 1) zezhe 资源 (import_channel='zezhe' 或 'zezemom_excel') → basic + vip + admin 都直接开
  // 2) 其他 vip 资源 → vip + admin 直接开, basic 看锁
  // 3) code 资源 (pay_type='code') → basic + vip 都要流明解锁, admin 免
  // 兼容 zezhe + zezemom_excel 两种命名
  const isZezheChannel = (ch?: string) => ch === 'zezhe' || ch === 'zezemom_excel';
  const isVipLocked = (item: Resource): boolean => {
    if (userGroup === 'admin') return false;
    if (userGroup === 'svip') return false;  // 2026-10-15: svip 永久全开
    if (userGroup === 'vip') return false;  // VIP 全开
    if (isZezheChannel(item.importChannel)) return false;  // zezhe 永远不锁
    if (isCodeResource(item)) return false;  // code 走付费流明, 不算锁
    return true;  // 其他 basic 看都是 vip 锁
  };

  // 2026-10-15: basic 用户看 vip 资源 (pay_type='vip') 时, 显示 5 积分解锁按钮 (不是 5 流明)
  const isVipResourceBasicCredits = (item: Resource): boolean => {
    return userGroup === 'basic' && item.payType === 'vip';
  };

  const isAdminDirectOpen = (item: Resource): boolean => {
    return userGroup === 'admin' && isCodeResource(item);
  };

  const isCodeResource = (item: Resource): boolean => {
    // pay_type 优先 (更准), 兼容 access_level
    // 2026-08-16: payType='lumen' 也算 (admin 手动发布的流明资源, 跟 code 资源一样需要流明解锁)
    return item.payType === 'code' || item.payType === 'lumen' || item.accessLevel === 'code';
  };

  const codeResourceLocked = (item: Resource): boolean => {
    if (isAdminDirectOpen(item)) return false;
    if (item.unlocked) return false;  // 已解锁
    return isCodeResource(item);
  };

  // 切 section → 重置 subCategory + 重新拉
  const switchSection = (s: SectionKey) => {
    setSection(s);
    setSubCategory('');
  };

  // 拉分类按钮列表
  const fetchCategories = useCallback(async () => {
    try {
      const params = new URLSearchParams({ section, pageSize: '1' });
      const r = await fetch(`/api/catalog?${params}&zone=library`);
      const d = await r.json();
      setCategories(d.categories || []);
    } catch { setCategories([]); }
  }, [section]);

  // 拉资源列表 (改用 /api/catalog, 跟 /titles 同一套)
  const fetchItems = useCallback(async (p = 1, reset = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: p.toString(),
        pageSize: pageSize.toString(),
        section,
        sort,
        zone: 'library',
      });
      if (query) params.set('q', query);
      if (subCategory) {
        if (section === 'zezhe') params.set('sheet', subCategory);
        else params.set('source', subCategory);
      }
      const res = await fetch(`/api/catalog?${params}`, { cache: 'no-store' });
      const data = await res.json();
      const newItems = data.items || [];

      // 查 code 资源的解锁状态 (pay_type='code' 或 accessLevel='code')
      if (section === 'code' && userId) {
        const codeIds = newItems.filter((i: Resource) => i.payType === 'code' || i.accessLevel === 'code').map((i: Resource) => i.id);
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

      if (reset) setItems(newItems);
      else setItems(prev => [...prev, ...newItems]);
      setTotal(data.total || 0);
      setPage(p);
    } catch { addToast('error', '加载失败'); }
    finally { setLoading(false); }
  }, [section, subCategory, query, pageSize, sort, userId, getToken, addToast]);

  // 切 section / subCategory / sort → 重新拉
  useEffect(() => {
    setItems([]);
    setPage(1);
    fetchItems(1, true);
    fetchCategories();
  }, [section, subCategory, sort]);

  // 2026-07-28: 切到 code 区时, 拉用户流明余额 (解锁预检用)
  useEffect(() => {
    if (section !== 'code' || !userId) return;
    const t = getToken();
    if (!t) return;
    fetch('/api/user/balance', { headers: { Authorization: 'Bearer ' + t } })
      .then(r => r.json())
      .then(d => { if (typeof d.lumen_balance === 'number') setLumenBalance(d.lumen_balance); })
      .catch(() => {});
  }, [section, userId, getToken]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setItems([]);
    setPage(1);
    fetchItems(1, true);
  };

  // 解锁 code/vip 资源
  const handleUnlock = async (item: Resource) => {
    if (isAdminDirectOpen(item)) {
      // admin 直接打开
      window.open(item.link, '_blank');
      return;
    }
    // 2026-08-17 P0: viewer 也能解锁 (跟 basic/vip 一样流明扣减)
    //   user (注册后未激活) 也能进流明解锁流程, 流明不够弹"需购买流明"提示
    //   任何人登录后 status='active' 都能进, server 端 unlock API 鉴权
    if (userGroup !== 'basic' && userGroup !== 'vip' && userGroup !== 'svip' && userGroup !== 'admin' && userGroup !== 'viewer') {
      addToast('error', '请先激活 basic / vip 会员后再解锁');
      return;
    }

    // 2026-10-15: basic 用 5 积分解锁 vip 资源 (pay_type='vip') - 弹确认 modal
    if (isVipResourceBasicCredits(item)) {
      if (!confirm(`确认消耗 5 积分解锁这个 vip 链接？\n\n资源: ${item.name}\n当前积分: ${pointsBalance}`)) return;
      setUnlocking(prev => new Set(prev).add(item.id));
      try {
        const r = await fetch('/api/resources/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
          body: JSON.stringify({ resourceId: item.id, resourceName: item.name }),
        });
        const d = await r.json();
        if (d.success) {
          addToast('unlock', d.message || '✅ 5 积分解锁 vip 链接');
          setItems(prev => prev.map(i => i.id === item.id ? { ...i, unlocked: true } : i));
          if (typeof d.credits_balance_after === 'number') setPointsBalance(d.credits_balance_after);
          setTimeout(() => window.open(item.link, '_blank'), 500);
        } else if (d.need === 'credits') {
          addToast('error', `积分不足, 需要 ${d.cost} 积分, 当前 ${d.balance} 积分`);
        } else {
          addToast('error', d.error || '解锁失败');
        }
      } catch (e: any) {
        addToast('error', '网络错误: ' + e.message);
      } finally {
        setUnlocking(prev => { const n = new Set(prev); n.delete(item.id); return n; });
      }
      return;
    }

    // 2026-07-28: 流明不足预检 (跟服务端 402 错对应, 直接弹购买提示)
    if (userGroup !== 'admin' && userGroup !== 'svip' && lumenBalance < (item.lumenCost || 1)) {
      // 2026-07-29: 拉 weekly credit 看能不能用周额度
      let creditAvailable = 0;
      try {
        const tk = localStorage.getItem('token');
        const r = await fetch('/api/user/weekly-credit', { headers: { Authorization: 'Bearer ' + (tk || '') } });
        if (r.ok) {
          const d = await r.json();
          creditAvailable = d.left || 0;
        }
      } catch {}
      setLumenModal({ cost: item.lumenCost || 1, balance: lumenBalance, resourceName: item.name, creditAvailable });
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
        // 2026-07-28: 刷新余额
        if (typeof d.lumen_balance_after === 'number') setLumenBalance(d.lumen_balance_after);
        setTimeout(() => window.open(item.link, '_blank'), 500);
      } else if (d.need === 'lumen') {
        // 2026-07-28: 服务端检测流明不足 (并发场景), 弹购买提示
        setLumenModal({ cost: d.cost || item.lumenCost || 1, balance: d.balance ?? 0, resourceName: item.name, creditAvailable: d.credit_available || 0 });
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

  // 2026-07-26: admin 删除资源 (软删 / 硬删) — library 每条加 admin 删除能力
  // 跟首页 detail modal 同套逻辑: DELETE /api/admin/resources/{id}[?hard=true]
  // 软删 = status='deleted', search/catalog 看不见, 可恢复
  // 硬删 = 物理删除 + CASCADE 清理 xx_resource_links/xx_link_feedback/xx_publish_log, 不可恢复
  const handleAdminDelete = async (item: Resource, hard: boolean) => {
    if (hard) {
      // 三级确认, 防止误操作
      if (!confirm(`🔥 硬删整个资源?\n\n资源 ID: ${item.id}\n名称: ${item.name}\n\n⚠️ 物理删除: 数据从数据库清空, 不可恢复\n⚠️ 同时级联删除 xx_resource_links / xx_link_feedback / xx_publish_log 全部关联行\n⚠️ library / titles / search 三个页面会立即同步消失`)) return;
      if (!confirm(`🔥 真的要硬删?\n\n最后一次确认: 删除后无法恢复!\n资源 ID: ${item.id}\n名称: ${item.name}`)) return;
      const hardConfirm = prompt(`输入资源 ID ${item.id} 确认硬删:`);
      if (hardConfirm !== String(item.id)) {
        addToast('error', '❌ 硬删已取消 (ID 不匹配)');
        return;
      }
    } else {
      if (!confirm(`🗑️ 软删整个资源 (含所有链接)?\n\n资源 ID: ${item.id}\n名称: ${item.name}\n来源: ${item.source}\n\n软删 = status='deleted', 可恢复\n不影响其他同名资源\n\nlibrary / titles / search 三个页面会立即同步消失`)) return;
    }
    const token = getToken();
    if (!token) {
      addToast('error', '❌ 未登录或 token 失效, 请重新登录');
      return;
    }
    try {
      const url = `/api/admin/resources/${item.id}${hard ? '?hard=true' : ''}`;
      const r = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      const d = await r.json();
      if (d.ok) {
        if (hard) {
          const cascaded = d.cascaded ? ` (副表 ${d.cascaded.xx_resource_links} 链接, ${d.cascaded.xx_link_feedback} 反馈)` : '';
          addToast('success', `🔥 已硬删, 不可恢复${cascaded}`);
        } else {
          addToast('success', `🗑️ 已软删 (${d.subLinks} 条链接, 资源可恢复)`);
        }
        // 2026-07-26: 立即从本地列表移除, 不依赖 refetch (快)
        setItems(prev => prev.filter(i => i.id !== item.id));
        setTotal(prev => Math.max(0, prev - 1));
      } else if (r.status === 401) {
        addToast('error', `❌ 401 token 无效 — 重新登录后再试`);
      } else if (r.status === 403) {
        addToast('error', `❌ 403 需要 admin 权限`);
      } else if (r.status === 404) {
        addToast('error', `❌ 404 资源不存在, 刷新页面`);
      } else {
        addToast('error', `❌ ${r.status} ${d.error || '删除失败'}`);
      }
    } catch (e: any) {
      addToast('error', '❌ 网络错误: ' + e.message);
    }
  };

  // 2026-07-26: admin 删单个链接 (PATCH/DELETE /api/admin/links) — library 每条加 admin 链接级删除
  const handleAdminDeleteLink = async (item: Resource, source: string) => {
    if (!confirm(`🗑️ 删除 ${source} 链接?\n\n资源 ID: ${item.id}\n来源: ${source}\n\n链接级删除, 不会动资源本身\n(其他链接不受影响)`)) return;
    const token = getToken();
    if (!token) {
      addToast('error', '❌ 未登录或 token 失效, 请重新登录');
      return;
    }
    try {
      const r = await fetch('/api/admin/links', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ resourceId: item.id, source }),
      });
      const d = await r.json();
      if (d.ok) {
        addToast('success', d.resourceDeleted ? '🗑️ 已删除 (资源无链接, 已软删)' : '🗑️ 已删除');
        // 局部更新: 从 links 数组里移除这个 source
        setItems(prev => prev.map(i => {
          if (i.id !== item.id) return i;
          return {
            ...i,
            links: i.links?.filter(l => l.source !== source),
          };
        }));
        // 如果资源被自动软删了, 移除整行
        if (d.resourceDeleted) {
          setItems(prev => prev.filter(i => i.id !== item.id));
          setTotal(prev => Math.max(0, prev - 1));
        }
      } else if (r.status === 401) {
        addToast('error', `❌ 401 token 无效 — 重新登录后再试`);
      } else if (r.status === 403) {
        addToast('error', `❌ 403 需要 admin 权限`);
      } else if (r.status === 404) {
        addToast('error', `❌ 404 ${d.error} — 这条链接可能已经被删, 刷新页面`);
      } else {
        addToast('error', `❌ ${r.status} ${d.error || '删除失败'}`);
      }
    } catch (e: any) {
      addToast('error', '❌ 网络错误: ' + e.message);
    }
  };

  const currentSection = SECTIONS.find(s => s.key === section)!;
  const subCategoryLabel = subCategory || '全部';
  const subCategoryType = section === 'zezhe' ? 'sheet' : '网盘';

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <header className="sticky top-0 z-40 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/" className="w-9 h-9 shrink-0 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-lg shadow-lg shadow-violet-500/20 hover:scale-105 transition">
                📋
              </Link>
              <div className="min-w-0">
                <h1 className="text-lg font-bold bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent tracking-wide">
                  资源库
                </h1>
                <p className="text-[11px] text-white/40">三区浏览 · 共 {total.toLocaleString()} 条</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* 排序切换 — 2026-10-22 暗色 segmented control */}
              {/* 2026-10-22 mobile: 排序按钮收窄, 避免 375px 下把 header 撑爆 */}
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.06] border border-white/[0.08]">
                <button onClick={() => setSort('asc')}
                  className={`px-2 sm:px-2.5 py-1.5 rounded-md text-[11px] sm:text-xs font-medium transition ${
                    sort === 'asc'
                      ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm'
                      : 'text-white/50 hover:text-white/80 hover:bg-white/[0.06]'
                  }`}>
                  <span className="sm:hidden">↑</span><span className="hidden sm:inline">↑ 正序</span>
                </button>
                <button onClick={() => setSort('desc')}
                  className={`px-2 sm:px-2.5 py-1.5 rounded-md text-[11px] sm:text-xs font-medium transition ${
                    sort === 'desc'
                      ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm'
                      : 'text-white/50 hover:text-white/80 hover:bg-white/[0.06]'
                  }`}>
                  <span className="sm:hidden">↓</span><span className="hidden sm:inline">↓ 倒序</span>
                </button>
              </div>
              {/* 2026-08-17: 个人中心入口 (viewer 限制页只让进 library/profile, 直接给链接免得 AuthGuard 拦截) */}
              {userName && (
                <Link href="/profile" className="px-2.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] rounded-lg text-xs transition text-white/80 flex items-center gap-1 border border-white/[0.08]">
                  <span>👤</span><span className="hidden sm:inline max-w-[80px] truncate">{userName}</span>
                </Link>
              )}
              {/* 2026-08-17 P0: 顶部统一 VIP 购买入口 (用户要求不要每条资源后, 改放顶部) */}
              <button onClick={() => setUpgradeModal(true)}
                className="px-2.5 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 rounded-lg text-xs text-white font-medium transition flex items-center gap-1 whitespace-nowrap shadow-lg shadow-amber-500/20">
                <span>💎</span><span className="hidden sm:inline">购买 VIP</span>
              </button>
              <Link href="/" className="px-2.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] rounded-lg text-xs transition text-white/70 border border-white/[0.08] whitespace-nowrap">
                <span className="hidden sm:inline">← 影视区</span><span className="sm:hidden">←</span>
              </Link>
            </div>
          </div>

          {/* 3 大区 Tab — 2026-10-22 暗色卡片式 */}
          {/* 2026-10-22 mobile: 横向滑动 (3 张卡竖排会占掉半屏), PC 端 3 列网格 */}
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1.5 scrollbar-hide md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
            {SECTIONS.map(s => {
              const active = s.key === section;
              return (
                <button
                  key={s.key}
                  onClick={() => switchSection(s.key)}
                  className={`min-w-[210px] md:min-w-0 px-3.5 py-2.5 md:py-3 rounded-2xl text-left transition-all duration-200 border backdrop-blur-sm ${
                    active
                      ? SECTION_TAB_ACTIVE[s.key]
                      : 'bg-white/[0.03] text-white/50 hover:bg-white/[0.07] hover:text-white/80 border-white/[0.07]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5 md:mb-1">
                    <span className={`text-lg transition ${active ? 'scale-110' : 'opacity-70'}`}>{s.icon}</span>
                    <span className="font-semibold text-sm">{s.label}</span>
                  </div>
                  <div className="text-[11px] text-white/45 leading-tight line-clamp-1">{s.desc}</div>
                </button>
              );
            })}
          </div>

          {/* 业务规则说明 (2026-07-25 用户硬规则版) - 折叠 */}
          <details className="mb-3 text-xs group">
            <summary className="cursor-pointer text-white/45 hover:text-white/80 select-none transition inline-flex items-center gap-1.5">
              <span className="inline-block transition-transform group-open:rotate-90">▶</span>
              <span>💡 查看 3 大区业务规则 + 注册流程</span>
            </summary>
            <div className="mt-2 p-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl space-y-3 text-white/70">
              <div className="font-semibold text-white/90">📋 资源访问规则（硬性版）</div>
              <ul className="space-y-1.5 ml-1">
                <li className="flex gap-2"><span className="text-pink-400 shrink-0">👑</span><span><b className="text-pink-400">泽泽妈妈115文档</b>：basic 会员可直接打开（无需 VIP）</span></li>
                <li className="flex gap-2"><span className="text-amber-400 shrink-0">🔒</span><span><b className="text-amber-400">VIP 区</b>：VIP 会员直接打开，basic 会员显示 VIP 锁（需升级 VIP）</span></li>
                <li className="flex gap-2"><span className="text-cyan-400 shrink-0">💎</span><span><b className="text-cyan-400">单独付费区</b>：basic + VIP 都需消耗流明解锁（admin 免流明）</span></li>
              </ul>
              <div className="font-semibold text-white/90 pt-1">🔑 注册流程</div>
              <ul className="space-y-1.5 ml-1">
                <li className="flex gap-2"><span className="text-white/30 shrink-0">1.</span><span><b className="text-white/90">拿邀请码</b>：找站长微信要（站内不开放公开注册）</span></li>
                <li className="flex gap-2"><span className="text-white/30 shrink-0">2.</span><span><b className="text-white/90">注册</b>：用邀请码 + 邮箱 + 密码注册</span></li>
                <li className="flex gap-2"><span className="text-white/30 shrink-0">3.</span><span><b className="text-white/90">自动 basic</b>：注册成功自动成为 basic 会员，可看泽泽妈妈文档</span></li>
                <li className="flex gap-2"><span className="text-white/30 shrink-0">4.</span><span><b className="text-white/90">升级 VIP</b>：basic 会员才能买 VIP 码（30/90/365/永久）</span></li>
                <li className="flex gap-2"><span className="text-white/30 shrink-0">5.</span><span><b className="text-white/90">全开</b>：VIP 会员可看全站资源（含 VIP 区全部）</span></li>
              </ul>
            </div>
          </details>

          {/* 当前区信息条 — 2026-10-22 暗色 */}
          <div className={`mb-3 px-3.5 py-2.5 rounded-xl text-xs bg-gradient-to-r ${SECTION_COLOR[section]} border flex items-center gap-2 flex-wrap backdrop-blur-sm`}>
            <span className="font-semibold">{currentSection.icon} {currentSection.label}</span>
            <span className="text-white/30">·</span>
            <span className="text-white/60">{currentSection.desc}</span>
            {subCategory && (
              <>
                <span className="text-white/30">·</span>
                <span className="text-white/60">
                  分类: <span className="font-semibold text-violet-300">{subCategoryLabel}</span>
                  <span className="text-white/35 text-[10px] ml-1">({subCategoryType})</span>
                </span>
              </>
            )}
            <span className="text-white/30">·</span>
            <span className="text-white/50">按添加时间{sort === 'asc' ? '正序 (文档原始顺序)' : '倒序'}</span>
          </div>

          {/* 搜索框 — 2026-10-22 暗色 */}
          <form onSubmit={handleSearch} className="flex gap-2 mb-3">
            <div className="flex-1 relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 text-sm pointer-events-none">🔍</span>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`搜索 ${currentSection.label}...`}
                className="w-full bg-white/[0.04] border border-white/[0.09] rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-violet-500/15 transition"
              />
            </div>
            <button type="submit" className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 rounded-xl text-sm font-medium text-white transition shadow-lg shadow-violet-600/20">
              搜索
            </button>
          </form>

          {/* 分类按钮: zezhe → sheet, vip/code → source */}
          {/* 2026-10-14: active 状态跟随当前 section 配色 (粉紫/琥珀/青蓝), 跟整体视觉一致 */}
          <div className="mb-2">
            <div className="text-[11px] text-white/40 mb-2 flex items-center gap-2">
              <span>{section === 'zezhe' ? '按 sheet 分类' : '按网盘类型分类'}</span>
              <span className="text-white/20">·</span>
              <span>共 {categories.length} 个</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1.5 scrollbar-hide">
              <button onClick={() => setSubCategory('')}
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all ${
                  !subCategory
                    ? SECTION_CHIP_ACTIVE[section]
                    : 'bg-white/[0.05] text-white/50 hover:text-white/85 hover:bg-white/[0.1] border border-white/[0.07]'
                }`}>
                全部
              </button>
              {categories.map(c => (
                <button key={c.key} onClick={() => setSubCategory(c.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all ${
                    subCategory === c.key
                      ? SECTION_CHIP_ACTIVE[section]
                      : 'bg-white/[0.05] text-white/50 hover:text-white/85 hover:bg-white/[0.1] border border-white/[0.07]'
                  }`}>
                  {c.name} <span className="opacity-60 ml-0.5">{c.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4">
        <div className="rounded-2xl border border-white/[0.07] overflow-hidden bg-white/[0.02] backdrop-blur-sm">
          {/* Table header — 2026-08-08 mobile 适配: mobile 完全隐藏 (item 垂直堆叠展示, 不需要 header), PC (md+) 9 列横排保持原样 */}
          {/* 2026-10-22: 暗色表头 + 更好的列宽分配 (名称列更宽, 时间列收窄) */}
          <div className={`hidden md:grid gap-3 px-4 py-3 bg-white/[0.04] border-b border-white/[0.08] text-[11px] font-semibold text-white/45 uppercase tracking-wider ${userGroup === 'admin' ? 'md:grid-cols-[76px_86px_minmax(0,1fr)_104px_72px_76px_132px_84px_minmax(150px,auto)_minmax(150px,auto)]' : 'md:grid-cols-[76px_86px_minmax(0,1fr)_104px_72px_76px_132px_84px_minmax(150px,auto)]'}`}>
            <div>分类</div>
            <div>标签</div>
            <div>名称</div>
            <div>来源</div>
            <div>大小</div>
            <div>提取码</div>
            <div>添加时间</div>
            <div>状态</div>
            <div>操作</div>
            {userGroup === 'admin' && <div className="text-rose-400">🛠️ Admin</div>}
          </div>

          {items.map((item, idx) => {
            const isVipLock = isVipLocked(item);
            const isAdmin = isAdminDirectOpen(item);
            const isCodeLock = codeResourceLocked(item);
            const isUnlocked = item.unlocked;
            // 分类列: zezhe 用 doc_sheet, 其他用 category
            const showCategory = section === 'zezhe' && item.docSheet
              ? item.docSheet
              : item.category;
            const showIcon = CATEGORY_ICONS[showCategory] || '📁';
            // 2026-07-26: 顶层 admin = user_group='admin', 注意不要跟 isAdmin (isAdminDirectOpen) 撞名
            const isTopAdmin = userGroup === 'admin';
            // 2026-10-22: 斑马纹 (奇偶行交替微亮)
            const zebra = idx % 2 === 1 ? 'bg-white/[0.012]' : '';

            return (
              <div key={item.id}
                className={`grid grid-cols-[auto_auto_minmax(0,1fr)] md:flex md:flex-wrap md:items-center md:gap-3 gap-x-2 gap-y-1.5 px-3 md:px-4 md:py-3 py-2.5 border-b border-white/[0.05] transition-colors ${
                  isTopAdmin
                    ? 'md:grid-cols-[76px_86px_minmax(0,1fr)_104px_72px_76px_132px_84px_minmax(150px,auto)_minmax(150px,auto)]'
                    : 'md:grid-cols-[76px_86px_minmax(0,1fr)_104px_72px_76px_132px_84px_minmax(150px,auto)]'
                } ${zebra} hover:bg-white/[0.04] ${
                  isVipLock ? 'bg-amber-500/[0.07] hover:bg-amber-500/[0.10]' : ''
                } ${isCodeLock ? 'bg-cyan-500/[0.07] hover:bg-cyan-500/[0.10]' : ''}`}>
                {/* 分类 — sheet 优先, category 兜底 */}
                {/* 2026-10-22 mobile: 图标 + 分类名 竖排在第 1 列, 名称在第 3 列 (grid auto/auto/1fr) */}
                <div className="flex flex-col items-center gap-0.5 order-1 md:order-none md:gap-1 shrink-0 w-[54px] md:w-auto">
                  <div className="text-xl leading-none md:text-xl">{showIcon}</div>
                  <div className="text-[10px] text-white/45 truncate w-full text-center md:text-[11px]" title={showCategory}>{showCategory}</div>
                </div>
                {/* 标签 (大区角标) */}
                <div className="order-2 md:order-none shrink-0 w-[62px] md:w-auto">
                  <div className={`px-1.5 py-0.5 md:px-2 md:py-1 rounded-md md:rounded-lg text-[9px] md:text-[10px] font-semibold text-center tracking-wide ${SECTION_BADGE[section]}`}>
                    {section === 'zezhe' ? '👑 ZEZHE' : section === 'vip' ? '🔒 VIP' : '💎 CODE'}
                  </div>
                  {item.payType === 'code' && section === 'vip' && (
                    <div className="text-[9px] text-amber-400 mt-0.5 text-center">💎付费</div>
                  )}
                </div>
                {/* 名称 */}
                {/* 2026-10-22 mobile: 名称跟分类/角标同一行 (flex:1), 不再独占一行, 省一半高度 */}
                <div className="min-w-0 flex-1 order-3 md:order-none md:w-auto">
                  <div className="text-white/90 font-medium text-sm md:text-[15px] leading-snug line-clamp-2 hover:text-white transition-colors" title={item.name}>{item.name}</div>
                  {item.tmdbIdRaw && item.tmdbIdRaw !== 'NOMATCH' && item.tmdbIdRaw !== 'GARBLED' && item.tmdbIdRaw.length >= 4 && (
                    <div className="text-[10px] md:text-[11px] text-emerald-400/80 font-mono mt-0.5 md:mt-1">🎬 TMDB: {item.tmdbIdRaw}</div>
                  )}
                  {/* 2026-10-22 mobile: 来源/大小/时间/提取码 合并成一行 meta (PC 端各占独立列, 这里隐藏) */}
                  <div className="md:hidden flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[10px] text-white/45">
                    <span className="truncate max-w-[110px]">{item.sourceDisplay || (item.source ? String(item.source).replace(/ \[deleted\]$/, '') : null) || '—'}</span>
                    {item.size && <><span className="text-white/20">·</span><span className="font-mono">{item.size}</span></>}
                    <span className="text-white/20">·</span>
                    <span className="font-mono">{fmtDate(item.createdAt)}</span>
                    {item.linkCode && (
                      <>
                        <span className="text-white/20">·</span>
                        <button onClick={() => handleCopy(item.linkCode!, '提取码')}
                          className="px-1.5 py-0.5 bg-amber-500/15 text-amber-300 rounded font-mono border border-amber-500/25">
                          {item.linkCode}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {/* 来源 — 2026-10-22: mobile 合并到 meta 行, PC 独立列 */}
                <div className="hidden md:block text-sm text-white/55 truncate">{item.sourceDisplay || (item.source ? String(item.source).replace(/ \[deleted\]$/, '') : null) || '—'}</div>
                {/* 大小 — 2026-10-22: mobile 合并到 meta 行, PC 独立列 */}
                <div className="hidden md:block text-sm text-white/45 truncate font-mono">{item.size || '—'}</div>
                {/* 提取码 — 2026-10-22: mobile 合并到 meta 行, PC 独立列 */}
                <div className="hidden md:block text-sm">
                  {item.linkCode ? (
                    <button onClick={() => handleCopy(item.linkCode!, '提取码')} className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 rounded-md text-[11px] font-mono border border-amber-500/25 transition" title="点击复制提取码">
                      {item.linkCode}
                    </button>
                  ) : <span className="text-white/20">—</span>}
                </div>
                {/* 添加时间 (真实日期) — 2026-10-22: mobile 合并到 meta 行, PC 独立列 */}
                <div className="hidden md:block text-[11px] text-white/40 font-mono whitespace-nowrap" title={`资源 ID: ${item.id}`}>
                  {fmtDate(item.createdAt)}
                </div>
                {/* 状态 — 2026-10-22 mobile: 第 2 行第 1 列 */}
                <div className="text-sm order-4 md:order-none col-start-1 row-start-2 md:col-auto md:row-auto">
                  {isVipLock && <span className="px-2 py-1 bg-amber-500/20 text-amber-300 rounded-md text-[10px] whitespace-nowrap">🔒 锁</span>}
                  {isUnlocked && <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded-md text-[10px] whitespace-nowrap">✓ 已解锁</span>}
                  {isAdmin && <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded-md text-[10px] whitespace-nowrap">👑 免流明</span>}
                </div>
                {/* 2026-08-17 P0: "购买 VIP" 按钮已移到顶部 header 统一入口, 这里不再每条重复 */}
                {/* 操作 — 2026-10-22 mobile: 第 2 行第 2-3 列 (跟状态同一行) */}
                <div className="flex gap-1.5 flex-wrap items-center order-5 md:order-none col-start-2 col-span-2 row-start-2 md:col-auto md:col-span-auto md:row-auto">
                  {/* 2026-07-24: 多链接 (1对N 副链接) 优先显示, 副链接数>=2 加开全部按钮 */}
                  {item.links && item.links.length > 1 && !isVipLock && !isCodeLock ? (
                    <>
                      {item.links.slice(0, 2).map((l, idx) => {
                        const isMagnet = l.source === 'magnet' || l.source === 'ed2k';
                        return (
                          <button key={idx}
                            onClick={() => {
                              if (isMagnet) handleCopy(l.url, '磁力链接');
                              else window.open(l.url, '_blank', 'noopener');
                            }}
                            className={`px-2 py-1 rounded-lg text-[11px] text-white font-medium transition ${
                              idx === 0
                                ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90 shadow-lg shadow-violet-600/20'
                                : 'bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.08]'
                            }`}
                            title={l.source + (l.password ? ` · 提取码: ${l.password}` : '')}
                          >
                            {isMagnet ? '📋' : '🔗'} {l.source}{idx === 0 ? '★' : ''}
                          </button>
                        );
                      })}
                      {item.links.filter(l => l.source !== 'magnet' && l.source !== 'ed2k').length >= 2 && (
                        <button
                          onClick={() => {
                            item.links!
                              .filter(l => l.source !== 'magnet' && l.source !== 'ed2k')
                              .forEach((l, i) => {
                                setTimeout(() => {
                                  if (l.password) {
                                    const ok = window.confirm(`🔗 ${l.source} (提取码: ${l.password})\n\n确定打开？`);
                                    if (ok) window.open(l.url, '_blank', 'noopener');
                                  } else {
                                    window.open(l.url, '_blank', 'noopener');
                                  }
                                }, i * 500);
                              });
                          }}
                          className="px-2 py-1 rounded-lg text-[11px] text-white font-medium bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:opacity-90 transition shadow-lg shadow-fuchsia-600/20"
                          title="一键打开所有网盘链接"
                        >
                          🚀 {item.links.length}
                        </button>
                      )}
                    </>
                  ) : isMagnetOrEd2k(item.link) && !isVipLock && !isCodeLock ? (
                    <button onClick={() => handleCopy(item.link, '链接')}
                      className="px-2.5 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-[11px] text-white font-medium transition shadow-lg shadow-violet-600/20">
                      📋 复制
                    </button>
                  ) : isVipResourceBasicCredits(item) ? (
                    <button onClick={() => handleUnlock(item)} disabled={unlocking.has(item.id)}
                      className="px-2.5 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-90 rounded-lg text-[11px] text-white font-medium transition disabled:opacity-50 shadow-lg shadow-amber-500/20 whitespace-nowrap">
                      {unlocking.has(item.id) ? '解锁中...' : isUnlocked ? '🔓 已解锁' : '🪙 5 积分解锁'}
                    </button>
                  ) : isVipLock ? (
                    <button onClick={() => addToast('vip', '需要 VIP 才能打开')} disabled
                      className="px-2.5 py-1.5 bg-amber-500/15 text-amber-300 rounded-lg text-[11px] font-medium cursor-not-allowed border border-amber-500/25 whitespace-nowrap">
                      🔒 VIP 锁
                    </button>
                  ) : isCodeLock ? (
                    <button onClick={() => handleUnlock(item)} disabled={unlocking.has(item.id)}
                      className="px-2.5 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 rounded-lg text-[11px] text-white font-medium transition disabled:opacity-50 shadow-lg shadow-cyan-500/20 whitespace-nowrap">
                      {unlocking.has(item.id) ? '解锁中...' :
                        isAdmin ? '👑 免流明' :
                        isUnlocked ? '🔓 已解锁' :
                        `💎 解锁 (${item.lumenCost || 1}流明)`}
                    </button>
                  ) : (
                    <button onClick={() => handleOpen(item)}
                      className="px-2.5 py-1.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 rounded-lg text-[11px] text-white font-medium transition shadow-lg shadow-violet-600/20 whitespace-nowrap">
                      {isMagnetOrEd2k(item.link) ? '📋 复制' : '🔗 打开'}
                    </button>
                  )}
                </div>
                {/* 2026-07-26: admin 操作列 — 软删/硬删资源 + 删单个链接 (per-link) */}
                {isTopAdmin && (
                  <div className="flex flex-col gap-1 text-xs order-6 md:order-none col-span-3 row-start-3 md:col-auto md:col-span-auto md:row-auto w-full md:w-auto">
                    {/* 资源级: 软删 + 硬删 */}
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleAdminDelete(item, false)}
                        title="软删: status='deleted', search/catalog 看不见, 可恢复"
                        className="flex-1 px-1.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 rounded-md text-[10px] font-medium transition">
                        🗑️ 软删
                      </button>
                      <button
                        onClick={() => handleAdminDelete(item, true)}
                        title="硬删: 物理删除 + CASCADE 清理副表, 不可恢复"
                        className="flex-1 px-1.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/25 rounded-md text-[10px] font-bold transition">
                        🔥 硬删
                      </button>
                    </div>
                    {/* 链接级: 逐个删 (副表链接) */}
                    {item.links && item.links.length > 0 ? (
                      <div className="flex flex-wrap gap-0.5">
                        {Array.from(new Set(item.links.map(l => l.source))).map(src => (
                          <button
                            key={src}
                            onClick={() => handleAdminDeleteLink(item, src)}
                            title={`删 ${src} 链接 (其他链接不受影响)`}
                            className="px-1 py-0.5 bg-white/[0.05] hover:bg-rose-500/20 text-white/45 hover:text-rose-300 border border-white/[0.08] hover:border-rose-500/30 rounded text-[9px] transition">
                            ✕{src}
                          </button>
                        ))}
                      </div>
                    ) : item.source ? (
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => handleAdminDeleteLink(item, item.source!)}
                          title={`删 ${String(item.source).replace(/ \[deleted\]$/, '')} 链接 (主表老字段, 标 source='${item.source}')`}
                          className="px-1 py-0.5 bg-white/[0.05] hover:bg-rose-500/20 text-white/45 hover:text-rose-300 border border-white/[0.08] hover:border-rose-500/30 rounded text-[9px] transition">
                          ✕{String(item.source).replace(/ \[deleted\]$/, '')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}

          {items.length === 0 && !loading && (
            <div className="py-20 text-center">
              <div className="text-5xl mb-4 opacity-30">
                {section === 'code' ? '💎' : section === 'vip' ? '🔒' : '👑'}
              </div>
              <div className="text-white/40 text-base">
                {section === 'code' ? '暂无单独付费资源' : section === 'vip' ? '暂无 VIP 资源 (待归类也算在 VIP 里)' : '暂无泽泽妈妈文档资源'}
              </div>
              <div className="text-white/20 text-xs mt-2">试试切换分类或换个关键词</div>
            </div>
          )}

          {loading && (
            <div className="py-16 text-center">
              <div className="inline-block w-8 h-8 border-2 border-white/10 border-t-violet-500 rounded-full animate-spin" />
              <div className="text-white/35 text-sm mt-3">加载中...</div>
            </div>
          )}
        </div>

        {items.length < total && (
          <div className="flex justify-center mt-6">
            <button onClick={() => fetchItems(page + 1, false)} disabled={loading}
              className="px-8 py-3 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] rounded-xl text-sm text-white/80 disabled:opacity-50 transition backdrop-blur-sm">
              {loading ? '加载中...' : `加载更多 (剩余 ${(total - items.length).toLocaleString()} 条)`}
            </button>
          </div>
        )}

        <div className="text-center mt-3 text-xs text-white/30">
          共 {total.toLocaleString()} 条，当前显示 {items.length.toLocaleString()} 条
        </div>
      </main>

      {/* 2026-10-22: toast 移动端挪到居中底部 (原来固定左下角, 手机上会挡住操作按钮) */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center px-4 md:left-6 md:translate-x-0 md:items-start">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium shadow-2xl border ${
                t.type === 'copy' ? 'bg-emerald-600/95 text-white border-emerald-400/30' :
                t.type === 'unlock' ? 'bg-teal-600/95 text-white border-teal-400/30' :
                t.type === 'vip' ? 'bg-amber-500/95 text-white border-amber-400/30' :
                'bg-rose-600/95 text-white border-rose-400/30'
              }`}>
              {t.type === 'copy' ? '📋' : t.type === 'unlock' ? '✅' : t.type === 'vip' ? '🔒' : '✕'} {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 2026-07-28: 流明不足购买提示弹窗 */}
      <AnimatePresence>
        {lumenModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => setLumenModal(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-[#12121a] rounded-2xl p-6 w-full max-w-md border border-fuchsia-500/30 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="text-center mb-5">
                <div className="text-5xl mb-3">💎</div>
                <h3 className="text-xl font-bold text-fuchsia-300">流明不足</h3>
                <p className="text-sm text-white/60 mt-2">解锁需要消耗流明, 当前余额不足</p>
              </div>
              <div className="bg-white/5 rounded-xl p-4 mb-5 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/60">资源</span>
                  <span className="text-white truncate ml-2 max-w-[60%]" title={lumenModal.resourceName}>{lumenModal.resourceName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">所需流明</span>
                  <span className="text-fuchsia-300 font-bold">💎 {lumenModal.cost}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">当前余额</span>
                  <span className="text-amber-300 font-bold">💎 {lumenModal.balance}</span>
                </div>
                <div className="border-t border-white/10 pt-2 flex justify-between">
                  <span className="text-white/60">还差</span>
                  <span className="text-red-300 font-bold">💎 {Math.max(0, lumenModal.cost - lumenModal.balance)}</span>
                </div>
              </div>
              <div className="space-y-2">
                {/* 2026-07-29: 周免费额度手动触发 (VIP + credit_available > 0) */}
                {(lumenModal as any).creditAvailable > 0 && (
                  <button
                    onClick={async () => {
                      const item = lumenModal;
                      setLumenModal(null);
                      const token = localStorage.getItem('token');
                      const r = await fetch('/api/resources/unlock', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ resourceId: item.resourceId, use_credit: true }),
                      });
                      const data = await r.json();
                      if (data.success) {
                        addToast('success', data.message || '✅ 周免费额度解锁');
                        setItems(prev => prev.map(it => it.id === item.resourceId ? { ...it, unlocked: true } : it));
                        if (data.lumen_balance !== undefined) setLumenBalance(data.lumen_balance);
                      } else {
                        addToast('error', data.error || '解锁失败');
                      }
                    }}
                    className="block w-full text-center px-4 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 rounded-xl text-base font-semibold text-white"
                  >
                    🎁 用周免费额度 (还剩 {(lumenModal as any).creditAvailable} 次)
                  </button>
                )}
                <a href="/activate" onClick={() => setLumenModal(null)}
                  className="block w-full text-center px-4 py-3 bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:opacity-90 rounded-xl text-base font-semibold text-white">
                  🎫 立即兑换流明码
                </a>
                {/* 2026-07-29: 闲鱼买流明入口 (2元/10流明) */}
                <a href="/upgrade#lumen" target="_blank" rel="noopener noreferrer" onClick={() => setLumenModal(null)}
                  className="block w-full text-center px-4 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:opacity-90 rounded-xl text-sm font-semibold text-black">
                  🐟 闲鱼买流明 (¥2/10流明) →
                </a>
                <a href="/profile" onClick={() => setLumenModal(null)}
                  className="block w-full text-center px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-sm text-white/80">
                  查看我的流明余额 →
                </a>
                <button onClick={() => setLumenModal(null)} className="block w-full text-center px-4 py-2 text-sm text-white/40 hover:text-white/60">
                  取消
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2026-08-17: VIP 购买弹框 (iframe 跨域/sandbox 拦截 → 改用 window.open 新窗口打开) */}
      <AnimatePresence>
        {upgradeModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
            onClick={() => setUpgradeModal(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-[#12121a] rounded-2xl w-full max-w-md border border-amber-500/30 shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 text-lg">💎</span>
                  <h3 className="text-base font-semibold text-white">购买 VIP 会员</h3>
                </div>
                <button onClick={() => setUpgradeModal(false)}
                  className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-sm text-white/80">关闭</button>
              </div>
              <div className="px-5 py-5 space-y-3">
                <p className="text-sm text-white/80">
                  即将打开 VIP 购买页 <a href="https://zzmm-search.uk/upgrade" target="_blank" rel="noopener noreferrer" className="text-amber-300 underline">zzmm-search.uk/upgrade</a>
                </p>
                <p className="text-xs text-white/50">
                  购买后系统会发 VIP 激活码，去 <a href="/activate" className="text-amber-300 underline">/activate</a> 页面输入即可生效。
                </p>
                <div className="flex gap-2 pt-2">
                  <a href="https://zzmm-search.uk/upgrade" target="_blank" rel="noopener noreferrer"
                    onClick={() => setUpgradeModal(false)}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 rounded-lg text-sm font-semibold text-white text-center">
                    💎 立即购买
                  </a>
                  <button onClick={() => setUpgradeModal(false)}
                    className="px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white/80">取消</button>
                </div>
                <div className="text-[10px] text-red-300/70 pt-2 border-t border-white/10">
                  ⚠️ viewer 档用户即使升 VIP 仍受 viewer 页面限制，需邀请码完整解封。
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
