'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ListChecks, Calendar, ChevronRight } from 'lucide-react';
import ChartsSection from '@/components/charts/ChartsSection';
import CalendarSection from '@/components/charts/CalendarSection';
import NavMenu from '@/components/NavMenu';
import MobileNav from '@/components/MobileNav';
import { useRequireAuth } from '@/lib/use-require-auth';

type Tab = 'charts' | 'calendar';

function ChartsPageInner() {
  // 2026-08-15: client-side 鉴权 (替代不跑的 middleware)
  const { authChecked } = useRequireAuth('/charts');
  const searchParams = useSearchParams();
  const initialTab: Tab = searchParams.get('tab') === 'calendar' ? 'calendar' : 'charts';

  if (!authChecked) {
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/50 text-sm">加载中...</div>;
  }
  const [tab, setTab] = useState<Tab>(initialTab);

  // 2026-08-14: 观影推荐页
  // - 2 个 tab: 榜单 (ChartsSection) + 追剧日历 (CalendarSection)
  // - 公开访问 (不需要登录), middleware 已加白名单
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white pb-20 md:pb-6">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0f]/85 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <img src="/logo-hdzzmm.png" alt="HDZZMM" width={36} height={36} className="w-9 h-9 rounded-lg shrink-0" />
              <div className="min-w-0">
                <h1 className="text-lg font-bold bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
                  观影推荐
                </h1>
                <p className="text-[11px] text-white/40 truncate">榜单 + 追剧日历 · 数据源 TMDB / SIMKL / TVMaze</p>
              </div>
            </div>
            <NavMenu user={null} onLogout={() => {}} />
          </div>

          {/* Tab 切换 */}
          <div className="flex gap-1 mt-3 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] w-fit">
            <button
              onClick={() => setTab('charts')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                tab === 'charts' ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white border border-violet-400/40' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <ListChecks size={13} /> 榜单
            </button>
            <button
              onClick={() => setTab('calendar')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                tab === 'calendar' ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 text-white border border-violet-400/40' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <Calendar size={13} /> 追剧日历
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {tab === 'charts' ? <ChartsSection /> : <CalendarSection />}
      </main>

      <MobileNav user={null} />
    </div>
  );
}

export default function ChartsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/50 text-sm">加载中…</div>}>
      <ChartsPageInner />
    </Suspense>
  );
}
