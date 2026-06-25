'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Shield, Home, Lock } from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
    const userStr = localStorage.getItem('user') || '';
    if (!token) {
      router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    try {
      const u = JSON.parse(userStr);
      if (u.group !== 'admin') {
        // 不是 admin, 重定向到首页 (普通用户看到 forbidden 提示)
        router.push('/?forbidden=admin');
        return;
      }
      setAuthed(true);
    } catch {
      router.push('/login?redirect=' + encodeURIComponent(pathname));
    }
  }, [router, pathname]);

  if (!mounted || !authed) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-white/40 text-sm">验证管理员身份...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* 顶部 admin bar */}
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
          <Link href="/admin/stats-dashboard" className="text-white/60 hover:text-white">📊 详细统计</Link>
          <Link href="/admin/import" className="text-white/60 hover:text-white">📥 导入</Link>
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