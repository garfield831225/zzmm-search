'use client';
// 2026-07-17: 极简版 - 只查 localStorage.user.group, 不 fetch、不 redirect、不重试
// 服务端鉴权那套太复杂, 用户等不了
// 信任 localStorage, 没存就提示去登录
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Home } from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setMounted(true);
    // 唯一检查: localStorage.user.group === 'admin'
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u?.group === 'admin') setIsAdmin(true);
    } catch {}
  }, []);

  if (!mounted) {
    return <div className="min-h-screen bg-[#0a0a0f]" />;
  }

  if (!isAdmin) {
    // 简单提示 - 不重定向, 不 fetch, 让用户自己点登录
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-3">🔐</div>
          <h1 className="text-xl font-bold mb-2">需要 admin 登录</h1>
          <p className="text-white/60 text-sm mb-4">
            当前 localStorage 里没有 admin 用户信息<br />
            请用 admin 账号登录后, 再点管理后台
          </p>
          <div className="flex gap-2 justify-center">
            <Link href="/login?redirect=/admin" className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-pink-600 rounded-lg text-sm font-medium">
              去登录
            </Link>
            <Link href="/" className="px-5 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm">
              回首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // admin 验证通过 - 直接渲染
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="bg-[#0d0d14] border-b border-violet-500/30 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3 text-xs">
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
          <Link href="/admin/match-now" className="text-emerald-300 hover:text-emerald-200 font-medium">🔄 立即匹配</Link>
          <Link href="/admin/match" className="text-white/60 hover:text-white">🎬 TMDB管理</Link>
          <Link href="/admin/pay-config" className="text-white/60 hover:text-white">💰 付费配置</Link>
          <Link href="/admin/publish" className="text-white/60 hover:text-white">📢 对外发布</Link>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" className="text-white/40 hover:text-white/80 flex items-center gap-1">
              <Home className="w-3 h-3" /> 主页
            </Link>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
