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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    // 2026-07-16: 修 redirect loop - 优先 localStorage, 失败再 /api/auth/me, 5秒超时
    const syncAndCheck = async () => {
      let token = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
      let userStr = localStorage.getItem('user') || '';

      // 路径 1: localStorage 完整 → 直接放行
      if (token && userStr) {
        try {
          const u = JSON.parse(userStr);
          if (u.group === 'admin') {
            setAuthed(true);
            return;
          }
        } catch {}
      }

      // 路径 2: localStorage 缺 → 调 /api/auth/me (5s 超时)
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const r = await fetch('/api/auth/me', { credentials: 'include', signal: controller.signal });
        clearTimeout(timeout);
        if (r.ok) {
          const d = await r.json();
          if (d.token) {
            localStorage.setItem('token', d.token);
            localStorage.setItem('adminToken', d.token);
            localStorage.setItem('zzmm_token', d.token);
            token = d.token;
          }
          if (d.user) {
            const u = {
              id: d.user.id, username: d.user.username,
              group: d.user.user_group, expire_at: d.user.expire_at,
            };
            localStorage.setItem('user', JSON.stringify(u));
            userStr = JSON.stringify(u);
          }
        } else {
          setError('API 返回 ' + r.status);
        }
      } catch (e: any) {
        setError('同步失败: ' + (e?.message || 'timeout') + ' — 请重试');
      }

      // 路径 3: 验证结果
      if (!token || !userStr) {
        setError('localStorage 和 cookie 都没拿到用户信息, 请重新登录');
        return;
      }
      try {
        const u = JSON.parse(userStr);
        if (u.group !== 'admin') {
          router.push('/?forbidden=admin');
          return;
        }
        setAuthed(true);
      } catch (e: any) {
        setError('user 解析失败: ' + e.message);
      }
    };
    syncAndCheck();
  }, [router, pathname]);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-white/40 text-sm">加载中...</div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-3">🔐</div>
          <div className="text-white/60 text-sm mb-2">{error || '验证管理员身份...'}</div>
          <div className="text-white/30 text-xs mb-4">
            URL: {pathname}<br />
            token: {localStorage.getItem('token') ? '✓' : '✗'} ·
            user: {localStorage.getItem('user') ? '✓' : '✗'} ·
            cookie: 自动随请求发送
          </div>
          <div className="flex gap-2 justify-center">
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm">
              🔄 刷新重试
            </button>
            <button onClick={() => router.push('/login?redirect=' + encodeURIComponent(pathname))} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">
              重新登录
            </button>
          </div>
        </div>
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
          <Link href="/admin/import-tg" className="text-white/60 hover:text-white">📡 TG导入</Link>
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