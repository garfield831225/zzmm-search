'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronDown, Crown, Sparkles, ListChecks, Calendar, Music, Library, User, Gift, Shield, LogOut,
  Clapperboard, Gamepad2, Film, Gem,
} from 'lucide-react';

interface UserInfo {
  id: number;
  username: string;
  group: string;
  expire_at: string;
}

// 2026-11-05 导航改版 (用户拍板):
//   1. 新增「VIP专享站▾」: moviezone / game520 / 拾光影视 三个外链 (lucide 图标 + 霓虹配色)
//   2. 「线上观影▾」→「VIP观影区」单入口, 去掉下拉, 直跳 https://zzmm-search.uk/lovemovie
//   3. 原「VIP 影视区」(/vip) 入口下掉 —— xx_vip_links 20002 条播放链接 active=0, 播放全挂
//   4. 移动端 (md 以下): VIP观影区 放进「VIP专享站」下拉当第 4 项, 不占独立位置
//      (手机屏窄, 少一个一级菜单)
//   5. 显示门槛: basic 及以上 (basic/vip/admin), 跟原「线上观影」同门槛
//   6. /vip 页面本身保留 (21,129 条资源 + /admin/vip-sync 入口), 只是导航不再露脸

// VIP 专享站三个外站
const VIP_SITES = [
  { label: 'moviezone', href: 'https://moviezone.cc.cd/', icon: Clapperboard, color: 'text-violet-400', badge: '需机场' },
  { label: 'game520', href: 'https://game.zzmm-search.uk/', icon: Gamepad2, color: 'text-cyan-400', badge: '' },
  { label: '拾光影视', href: 'https://moviezone.cc.cd/shiguang/', icon: Film, color: 'text-amber-400', badge: '' },
];

// VIP 观影区 (星帆影视镜像站, 走 /lovemovie 307 到 lovemovie.zzmm-search.uk)
const LOVEMOVIE_URL = 'https://zzmm-search.uk/lovemovie';

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
        ? 'bg-violet-500/20 ring-1 ring-violet-400/50 shadow-[0_0_16px_rgba(167,139,250,0.35)]'
        : 'bg-white/[0.04] hover:bg-violet-500/[0.12] hover:ring-1 hover:ring-violet-400/35 border border-white/[0.06] hover:border-violet-400/30'
    }`;

  const dropdownItemCls = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/85 hover:bg-violet-500/[0.18] hover:text-white transition cursor-pointer';

  return (
    <div ref={containerRef} className="flex items-center gap-2 flex-wrap justify-end">
      {/* 1. VIP专享站▾ (2026-11-05 新增) */}
      {isVipLike && (
        <div className="relative">
          <button onClick={() => toggleMenu('sites')} className={menuBtnCls(openMenu === 'sites')}>
            <Gem size={14} className="text-fuchsia-300 transition-transform group-hover:scale-110" />
            <span>VIP专享站</span>
            <ChevronDown size={12} className={`transition-transform ${openMenu === 'sites' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'sites' && (
            <div className="absolute right-0 top-full mt-2 w-60 bg-[#12121f]/95 backdrop-blur-xl border border-fuchsia-400/25 rounded-xl shadow-[0_0_30px_rgba(232,121,249,0.25)] py-1.5 z-50">
              {VIP_SITES.map((s) => (
                <a
                  key={s.href}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpenMenu(null)}
                  className={dropdownItemCls}
                >
                  <s.icon size={14} className={s.color} />
                  <span className="flex-1">{s.label}</span>
                  {s.badge && (
                    <span className="text-[10px] leading-none font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-200 border border-amber-400/45 shadow-[0_0_10px_rgba(251,191,36,0.25)]">
                      {s.badge}
                    </span>
                  )}
                </a>
              ))}
              {/* 移动端: VIP观影区 塞进这个下拉 (PC 是独立一级入口) */}
              <div className="md:hidden my-1 border-t border-white/5" />
              <a
                href={LOVEMOVIE_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpenMenu(null)}
                className={`${dropdownItemCls} md:hidden`}
              >
                <Crown size={14} className="text-amber-300" />
                <span>VIP观影区</span>
              </a>
            </div>
          )}
        </div>
      )}

      {/* 2. 观影推荐▾ */}
      <div className="relative">
        <button onClick={() => toggleMenu('recommend')} className={menuBtnCls(openMenu === 'recommend')}>
          <ListChecks size={14} className="text-violet-300" />
          <span>观影推荐</span>
          <ChevronDown size={12} className={`transition-transform ${openMenu === 'recommend' ? 'rotate-180' : ''}`} />
        </button>
        {openMenu === 'recommend' && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-[#12121f]/95 backdrop-blur-xl border border-violet-400/25 rounded-xl shadow-[0_0_30px_rgba(139,92,246,0.25)] py-1.5 z-50">
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

      {/* 3. VIP观影区 (2026-11-05: 原「线上观影▾」, 去掉下拉直跳; 移动端在 VIP专享站下拉里) */}
      {isVipLike && (
        <div className="hidden md:block">
          <a
            href={LOVEMOVIE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={menuBtnCls(false)}
          >
            <Crown size={14} className="text-amber-300 transition-transform group-hover:scale-110" />
            <span>VIP观影区</span>
          </a>
        </div>
      )}

      {/* 4. 我的▾ (登录后才显示) */}
      {user && (
        <div className="relative">
          <button onClick={() => toggleMenu('me')} className={menuBtnCls(openMenu === 'me')}>
            <User size={14} className="text-cyan-300" />
            <span className="text-violet-300 font-medium">{user.username}</span>
            <ChevronDown size={12} className={`transition-transform ${openMenu === 'me' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'me' && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-[#12121f]/95 backdrop-blur-xl border border-violet-400/25 rounded-xl shadow-[0_0_30px_rgba(139,92,246,0.25)] py-1.5 z-50">
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

      {/* 5. 非影视区 (单 Link) */}
      <Link href="/nonfilm" className={menuBtnCls(false)}>
        <Music size={14} className="text-cyan-300 transition-transform group-hover:scale-110" />
        <span>非影视区</span>
      </Link>

      {/* 6. 文档资源库 (单 Link) */}
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
