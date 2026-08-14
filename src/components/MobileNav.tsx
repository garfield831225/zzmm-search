'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Compass, Tv, User } from 'lucide-react';

interface UserInfo {
  id: number;
  username: string;
  group: string;
  expire_at: string;
}

// 2026-08-14: 移动端底部 4 Tab
//   首页 / 推荐 / 线上 / 我的
// - 不放嵌套下拉 (移动端屏小, 用户拍板)
// - Tab bar fixed 底部, z-50, 玻璃态背景
// - 当前路由高亮 (violet → fuchsia 渐变指示器)
export default function MobileNav({ user }: { user: UserInfo | null }) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/charts') return pathname.startsWith('/charts');
    if (href === '/vip') return pathname.startsWith('/vip') || pathname.startsWith('/lovemovie');
    if (href === '/profile') return pathname.startsWith('/profile') || pathname.startsWith('/activate') || pathname.startsWith('/request') || pathname.startsWith('/admin');
    return false;
  };

  const tabs = [
    { href: '/', label: '首页', icon: Home, color: 'violet' },
    { href: '/charts', label: '推荐', icon: Compass, color: 'fuchsia' },
    { href: '/vip', label: '线上', icon: Tv, color: 'amber' },
    { href: user ? '/profile' : '/login', label: '我的', icon: User, color: 'cyan' },
  ];

  const colorMap: Record<string, string> = {
    violet: 'from-violet-500 to-violet-400',
    fuchsia: 'from-fuchsia-500 to-fuchsia-400',
    amber: 'from-amber-500 to-amber-400',
    cyan: 'from-cyan-500 to-cyan-400',
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0f]/85 backdrop-blur-xl border-t border-white/[0.06] safe-area-inset-bottom">
      <div className="grid grid-cols-4 px-1 py-1.5">
        {tabs.map(({ href, label, icon: Icon, color }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all duration-200 active:scale-95"
            >
              <div className={`relative w-9 h-9 flex items-center justify-center rounded-xl transition-all ${
                active ? `bg-gradient-to-br ${colorMap[color]} shadow-[0_0_12px_rgba(168,85,247,0.3)]` : ''
              }`}>
                <Icon size={18} className={active ? 'text-white' : 'text-white/60'} />
              </div>
              <span className={`text-[10px] font-medium ${active ? 'text-white' : 'text-white/50'}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
