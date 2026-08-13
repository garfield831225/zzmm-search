'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, Crown, Sparkles, ListChecks, Calendar, Music, Library, User, Gift, Shield, LogOut } from 'lucide-react';

interface UserInfo {
  id: number;
  username: string;
  group: string;
  expire_at: string;
}

// 2026-08-14: PC 工具栏 9 入口重排
//   1. 观影推荐▾ (榜单 / 追剧日历)
//   2. 线上观影▾ (VIP影视区 / VIP影视2区)
//   3. 我的▾ (个人中心 / 兑换中心 / 求片专区 / 管理中心[admin] / 退出)
//   4. 非影视区 (单 Link, 保留)
//   5. 文档资源库 (单 Link, 保留)
// 搜索框已挪到 hero 区域上方
export default function NavMenu({ user, onLogout }: { user: UserInfo | null; onLogout: () => void }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const isAdmin = user?.group === 'admin';
  const isVipLike = user && ['basic', 'vip', 'admin'].includes(user.group);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleMenu = (name: string) => {
    setOpenMenu(prev => prev === name ? null : name);
  };

  const menuBtnCls = (active: boolean) =>
    `group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${
      active
        ? 'bg-white/15 ring-1 ring-white/20'
        : 'bg-white/[0.04] hover:bg-white/10 border border-white/[0.06]'
    }`;

  const dropdownItemCls = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-white/10 hover:text-white transition cursor-pointer';

  return (
    <div ref={containerRef} className="flex items-center gap-2 flex-wrap justify-end">
      {/* 1. 观影推荐▾ */}
      <div className="relative">
        <button onClick={() => toggleMenu('recommend')} className={menuBtnCls(openMenu === 'recommend')}>
          <ListChecks size={14} className="text-violet-300" />
          <span>观影推荐</span>
          <ChevronDown size={12} className={`transition-transform ${openMenu === 'recommend' ? 'rotate-180' : ''}`} />
        </button>
        {openMenu === 'recommend' && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-[#1a1a2e]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 z-50">
            <Link href="/charts" onClick={() => setOpenMenu(null)} className={dropdownItemCls}>
              <ListChecks size={14} className="text-violet-400" />
              <span>榜单</span>
            </Link>
            <Link href="/charts?tab=calendar" onClick={() => setOpenMenu(null)} className={dropdownItemCls}>
              <Calendar size={14} className="text-cyan-400" />
              <span>追剧日历</span>
            </Link>
          </div>
        )}
      </div>

      {/* 2. 线上观影▾ */}
      {isVipLike && (
        <div className="relative">
          <button onClick={() => toggleMenu('online')} className={menuBtnCls(openMenu === 'online')}>
            <Crown size={14} className="text-amber-300" />
            <span>线上观影</span>
            <ChevronDown size={12} className={`transition-transform ${openMenu === 'online' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'online' && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-[#1a1a2e]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 z-50">
              <Link href="/vip" onClick={() => setOpenMenu(null)} className={dropdownItemCls}>
                <Crown size={14} className="text-amber-400" />
                <span>VIP 影视区</span>
              </Link>
              {user?.group === 'basic' ? (
                <Link href="/upgrade" onClick={() => setOpenMenu(null)} className={dropdownItemCls}>
                  <Sparkles size={14} className="text-violet-400" />
                  <span>VIP 影视 2 区 (升级)</span>
                </Link>
              ) : (
                <Link href="/lovemovie" target="_blank" rel="noopener" onClick={() => setOpenMenu(null)} className={dropdownItemCls}>
                  <Sparkles size={14} className="text-violet-400" />
                  <span>VIP 影视 2 区</span>
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. 我的▾ (登录后才显示) */}
      {user && (
        <div className="relative">
          <button onClick={() => toggleMenu('me')} className={menuBtnCls(openMenu === 'me')}>
            <User size={14} className="text-cyan-300" />
            <span className="text-violet-300 font-medium">{user.username}</span>
            <ChevronDown size={12} className={`transition-transform ${openMenu === 'me' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'me' && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-[#1a1a2e]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 z-50">
              <Link href="/profile" onClick={() => setOpenMenu(null)} className={dropdownItemCls}>
                <User size={14} className="text-cyan-400" />
                <span>个人中心</span>
              </Link>
              <Link href="/activate" onClick={() => setOpenMenu(null)} className={dropdownItemCls}>
                <Gift size={14} className="text-pink-400" />
                <span>兑换中心</span>
              </Link>
              <Link href="/request" onClick={() => setOpenMenu(null)} className={dropdownItemCls}>
                <Sparkles size={14} className="text-amber-400" />
                <span>求片专区</span>
              </Link>
              {isAdmin && (
                <Link href="/admin" onClick={() => setOpenMenu(null)} className={dropdownItemCls}>
                  <Shield size={14} className="text-violet-400" />
                  <span>管理中心</span>
                </Link>
              )}
              <div className="my-1 border-t border-white/5" />
              <button
                onClick={() => { setOpenMenu(null); onLogout(); }}
                className={`${dropdownItemCls} w-full text-left text-red-300/80 hover:text-red-200`}
              >
                <LogOut size={14} />
                <span>退出</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 4. 非影视区 (单 Link) */}
      <Link href="/nonfilm" className={menuBtnCls(false)}>
        <Music size={14} className="text-cyan-300 transition-transform group-hover:scale-110" />
        <span>非影视区</span>
      </Link>

      {/* 5. 文档资源库 (单 Link) */}
      <Link href="/library" className={menuBtnCls(false)}>
        <Library size={14} className="text-violet-300 transition-transform group-hover:scale-110" />
        <span>文档资源库</span>
      </Link>

      {/* 未登录：登录/注册 按钮 (兜底) */}
      {!user && (
        <Link href="/login" className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition">
          登录 / 注册
        </Link>
      )}
    </div>
  );
}
