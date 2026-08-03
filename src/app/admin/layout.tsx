'use client';
// 2026-07-25: 极简版 v2 - 去掉 mounted 守卫, 直接渲染 children
// 顶栏只显示 admin link, 权限检查在 client useEffect 内异步做
// 解决: mounted 守卫 + framer-motion SSR hydration 冲突导致整个 client tree 崩, body 空白
// 2026-07-26: 加 ErrorBoundary + 直接 render children 不返空 div

import { useEffect, useState, Component, ReactNode } from 'react';
import Link from 'next/link';
import { Shield, Home } from 'lucide-react';

// 2026-07-26: ErrorBoundary - 防止子页面 mount 失败把整个 admin 弄成空白
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; err?: string }> {
  constructor(p: any) { super(p); this.state = { hasError: false }; }
  static getDerivedStateFromError(err: Error) { return { hasError: true, err: err.message }; }
  componentDidCatch(err: Error, info: any) {
    console.error('[admin-layout-error]', err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 m-6 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] text-rose-200">
          <div className="text-base font-semibold mb-2">⚠️ 页面加载出错</div>
          <div className="text-sm text-rose-300/80 mb-3">{this.state.err}</div>
          <div className="flex gap-2">
            <button onClick={() => window.location.reload()} className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 rounded text-xs">
              刷新页面
            </button>
            <Link href="/admin" className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded text-xs">
              返回总览
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // 唯一检查: localStorage.user.user_group (兼容老 group 字段)
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u?.user_group === 'admin' || u?.group === 'admin') setIsAdmin(true);
    } catch {}
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* 顶栏永远渲染, 简单清晰 */}
      <div className="bg-[#0d0d14] border-b border-violet-500/30 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3 text-xs flex-wrap">
          <div className="flex items-center gap-1.5 text-violet-300 font-semibold">
            <Shield className="w-3.5 h-3.5" />
            管理后台
          </div>
          <span className="text-white/20">|</span>
          <Link href="/admin" className="text-white/60 hover:text-white">🏠 总览</Link>
          <Link href="/admin/codes" className="text-white/60 hover:text-white">🎫 卡密</Link>
          <Link href="/admin/invites" className="text-white/60 hover:text-white">🎟️ 邀请码</Link>
          <Link href="/admin/blacklist" className="text-white/60 hover:text-white">🚫 黑名单</Link>
          <Link href="/admin/users" className="text-white/60 hover:text-white">👥 用户列表</Link>
          <Link href="/admin/stats-dashboard" className="text-white/60 hover:text-white">📊 详细统计</Link>
          <Link href="/admin/import" className="text-white/60 hover:text-white">📥 导入</Link>
          <Link href="/admin/import-tg" className="text-white/60 hover:text-white">📡 TG导入</Link>
          <Link href="/admin/import-hub" className="text-pink-300 hover:text-pink-200 font-medium">📤 数据导入中心</Link>
          <Link href="/admin/match-now" className="text-emerald-300 hover:text-emerald-200 font-medium">🔄 立即匹配</Link>
          <Link href="/admin/vip-sync" className="text-amber-300 hover:text-amber-200 font-medium">🎬 VIP同步</Link>
          <Link href="/admin/match" className="text-white/60 hover:text-white">🎬 TMDB管理</Link>
          <Link href="/admin/pay-config" className="text-white/60 hover:text-white">💰 付费配置</Link>
          <Link href="/admin/publish" className="text-white/60 hover:text-white">📢 对外发布</Link>
          <div className="ml-auto flex items-center gap-2">
            {!isAdmin && (
              <Link href="/login?redirect=/admin" className="text-amber-300 hover:text-amber-200">
                🔐 去登录
              </Link>
            )}
            <Link href="/" className="text-white/40 hover:text-white/80 flex items-center gap-1">
              <Home className="w-3 h-3" /> 主页
            </Link>
          </div>
        </div>
      </div>

      {/* 2026-07-26: ErrorBoundary 包 children, mount 失败显示降级 UI */}
      <ErrorBoundary>{children}</ErrorBoundary>
    </div>
  );
}
