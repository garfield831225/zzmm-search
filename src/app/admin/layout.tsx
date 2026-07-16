// 2026-07-17: 重写 - 完全服务端鉴权，绕开所有 localStorage 坑
// 之前用 'use client' 查 localStorage / /api/auth/me 都不可靠
// 这次直接用 next/headers cookies() + jwt verify, 在 server 端判定 admin
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { redirect } from 'next/navigation';
import { neon } from '@neondatabase/serverless';
import Link from 'next/link';
import { Shield, Home } from 'lucide-react';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('zzmm_token')?.value || cookieStore.get('token')?.value || '';

  if (!token) {
    // 没 token → 跳 login (从 query 拿 redirect 维持原路径)
    redirect('/login?redirect=/admin');
  }

  let payload: any;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    redirect('/login?redirect=/admin');
  }

  // 直接查 DB 拿真实 user_group (不能信 JWT 里的 group, 可能过期/被改)
  let user: { id: number; username: string; user_group: string } | null = null;
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const rows = await sql`SELECT id, username, user_group FROM xx_users WHERE id = ${payload.id} LIMIT 1` as any[];
    if (rows[0]) user = rows[0];
  } catch (e) {
    // DB 失败 - 降级用 JWT 里的 group
    user = { id: payload.id, username: payload.username, user_group: payload.group || 'user' };
  }

  if (!user) {
    redirect('/login?redirect=/admin');
  }

  if (user.user_group !== 'admin') {
    redirect('/?forbidden=admin');
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* 顶部 admin bar */}
      <div className="bg-[#0d0d14] border-b border-violet-500/30 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-violet-300 font-semibold">
            <Shield className="w-3.5 h-3.5" />
            管理后台
            <span className="ml-2 text-white/40 font-normal">({user.username})</span>
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
