'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Compass, Tv, User, Gem, X, Clapperboard, Gamepad2, Film, Crown } from 'lucide-react';

interface UserInfo {
  id: number;
  username: string;
  group: string;
  expire_at: string;
}

// 2026-11-05 移动端改版 (用户拍板): 底部加一个「专享」Tab
//   1. 底部从 4 格变 5 格: 首页 / 推荐 / 专享 / 线上 / 我的
//   2. 「专享」点开是底部抽屉面板: moviezone / game520 / 拾光影视 / VIP观影区
//      (三个外站 + 需机场角标; VIP观影区 直跳 lovemovie)
//   3. 原来的「线上」(/vip) 保留 —— xx_vip_links 20002 条 status='ok' (表里没有 'active' 这个值),
//      只是 last_ok_at 停在 9-07 没复检, 页面还出 2125 条, 入口不能砍
//   4. 抽屉打开时锁 body 滚动; 路由一变自动收起
//   5. 顶部 NavMenu 的「VIP专享站」下拉在手机端也保留 (跟底部 Tab 同一份内容, 两处入口)
//
// VIP 专享站三个外站 (跟桌面端 NavMenu 保持一致)
const VIP_SITES = [
  { label: 'moviezone', href: 'https://moviezone.cc.cd/', icon: Clapperboard, color: 'text-violet-400', badge: '需机场' },
  { label: 'game520', href: 'https://game.zzmm-search.uk/', icon: Gamepad2, color: 'text-cyan-400', badge: '' },
  { label: '拾光影视', href: 'https://moviezone.cc.cd/shiguang/', icon: Film, color: 'text-amber-400', badge: '' },
];

// VIP 观影区 (星帆影视镜像站)
const LOVEMOVIE_URL = 'https://zzmm-search.uk/lovemovie';

export default function MobileNav({ user }: { user: UserInfo | null }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  // 路由一变自动收起抽屉
  useEffect(() => { setSheetOpen(false); }, [pathname]);

  // 抽屉开着时锁住 body 滚动
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [sheetOpen]);

  const isActive = (key: string) => {
    if (key === 'home') return pathname === '/';
    if (key === 'charts') return pathname.startsWith('/charts');
    if (key === 'vip') return pathname.startsWith('/vip') || pathname.startsWith('/lovemovie');
    if (key === 'profile') return pathname.startsWith('/profile') || pathname.startsWith('/activate') || pathname.startsWith('/request') || pathname.startsWith('/admin');
    return false;
  };

  const tabs = [
    { key: 'home', href: '/', label: '首页', icon: Home, color: 'violet' },
    { key: 'charts', href: '/charts', label: '推荐', icon: Compass, color: 'fuchsia' },
    { key: 'vipsites', href: '', label: '专享', icon: Gem, color: 'pink', sheet: true },
    { key: 'vip', href: '/vip', label: '线上', icon: Tv, color: 'amber' },
    { key: 'me', href: user ? '/profile' : '/login', label: '我的', icon: User, color: 'cyan' },
  ];

  const colorMap: Record<string, string> = {
    violet: 'from-violet-500 to-violet-400',
    fuchsia: 'from-fuchsia-500 to-fuchsia-400',
    pink: 'from-pink-500 to-pink-400',
    amber: 'from-amber-500 to-amber-400',
    cyan: 'from-cyan-500 to-cyan-400',
  };

  const tabIcon = (t: { key: string; icon: typeof Home; color: string }) => {
    const active = isActive(t.key);
    const Icon = t.icon;
    return (
      <div className={`relative w-9 h-9 flex items-center justify-center rounded-xl transition-all ${
        active ? `bg-gradient-to-br ${colorMap[t.color]} shadow-[0_0_12px_rgba(168,85,247,0.3)]` : ''
      }`}>
        <Icon size={18} className={active ? 'text-white' : 'text-white/60'} />
      </div>
    );
  };

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0f]/85 backdrop-blur-xl border-t border-white/[0.06] safe-area-inset-bottom">
        <div className="grid grid-cols-5 px-1 py-1.5">
          {tabs.map(({ key, href, label, icon: Icon, color, sheet }) => {
            const active = isActive(key);
            const inner = (
              <>
                {tabIcon({ key, icon: Icon, color })}
                <span className={`text-[10px] font-medium ${active ? 'text-white' : 'text-white/50'}`}>
                  {label}
                </span>
              </>
            );
            if (sheet) {
              return (
                <button
                  key={key}
                  onClick={() => setSheetOpen(true)}
                  className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
                >
                  {inner}
                </button>
              );
            }
            return (
              <Link
                key={key}
                href={href}
                className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
              >
                {inner}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── 专享抽屉 (底部弹出) ── */}
      {sheetOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}
          />
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-[61] bg-[#12121f]/95 backdrop-blur-xl border-t border-fuchsia-400/30 rounded-t-2xl shadow-[0_-10px_40px_rgba(232,121,249,0.28)] pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-white/5">
              <span className="text-sm font-semibold text-white flex items-center gap-2">
                <Gem size={15} className="text-pink-300" />
                VIP专享站
              </span>
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="关闭"
                className="text-white/45 hover:text-white transition p-1"
              >
                <X size={18} />
              </button>
            </div>
            <div className="py-1.5">
              {VIP_SITES.map((s) => (
                <a
                  key={s.href}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setSheetOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-white/85 hover:bg-violet-500/[0.18] active:bg-violet-500/[0.25] transition"
                >
                  <s.icon size={16} className={s.color} />
                  <span className="flex-1">{s.label}</span>
                  {s.badge && (
                    <span className="text-[10px] leading-none font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-200 border border-amber-400/45 shadow-[0_0_10px_rgba(251,191,36,0.25)]">
                      {s.badge}
                    </span>
                  )}
                </a>
              ))}
              <div className="my-1 border-t border-white/5" />
              <a
                href={LOVEMOVIE_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSheetOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm text-white/85 hover:bg-violet-500/[0.18] active:bg-violet-500/[0.25] transition"
              >
                <Crown size={16} className="text-amber-300" />
                <span>VIP观影区</span>
              </a>
            </div>
          </div>
        </>
      )}
    </>
  );
}
