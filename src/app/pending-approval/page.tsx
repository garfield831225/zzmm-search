'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// 2026-08-16 viewer-role: viewer pending 用户登录后看到此页
//  - 显示审核状态 (待审核 / 已通过 / 已拒绝)
//  - 提供 admin 联系方式 + 申请时间
//  - 状态变了支持重新登录
export default function PendingApprovalPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'unknown'>('unknown');
  const [loading, setLoading] = useState(true);

  // 检查审核状态
  useEffect(() => {
    const check = async () => {
      const u = typeof window !== 'undefined' ? localStorage.getItem('viewer_pending_user') : null;
      if (u) {
        try {
          setUser(JSON.parse(u));
        } catch {}
      }

      // 拉 /api/auth/me 看真实状态
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': 'Bearer ' + token },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.user) {
            setUser(data.user);
            localStorage.setItem('user', JSON.stringify(data.user));
            if (data.user.status === 'active' && data.user.user_group !== 'pending' && data.user.user_group !== 'viewer_pending') {
              setStatus('approved');
              // 跳 library
              setTimeout(() => router.push('/library'), 1500);
              return;
            }
            if (data.user.status === 'pending') {
              setStatus('pending');
            } else if (data.user.status === 'banned') {
              setStatus('rejected');
            }
          }
        }
      } catch {}
      setLoading(false);
    };
    check();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-white/60">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="bg-[#12121a] rounded-2xl p-8 border border-white/5">
          {/* 状态图标 */}
          <div className="flex justify-center mb-6">
            {status === 'approved' ? (
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <span className="text-5xl">✅</span>
              </div>
            ) : status === 'rejected' ? (
              <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-5xl">❌</span>
              </div>
            ) : (
              <div className="w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center">
                <span className="text-5xl">⏳</span>
              </div>
            )}
          </div>

          {/* 状态文案 */}
          {status === 'approved' && (
            <>
              <h1 className="text-2xl font-bold text-white text-center mb-3">🎉 审核已通过</h1>
              <p className="text-white/60 text-center mb-6 leading-relaxed">
                您的文档资源站账号已激活，正在跳转资源页...
              </p>
            </>
          )}

          {status === 'rejected' && (
            <>
              <h1 className="text-2xl font-bold text-white text-center mb-3">申请未通过</h1>
              <p className="text-white/60 text-center mb-6 leading-relaxed">
                您的申请未通过审核。账号已封禁。如有疑问请联系客服。
              </p>
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">
                微信: HKmaipanren
              </div>
            </>
          )}

          {(status === 'pending' || status === 'unknown') && (
            <>
              <h1 className="text-2xl font-bold text-white text-center mb-3">审核中</h1>
              <p className="text-white/60 text-center mb-6 leading-relaxed">
                您的申请已提交，管理员正在审核中。预计 1-3 个工作日内完成。
              </p>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-amber-300 text-sm space-y-2">
                <p>📋 <span className="font-medium">用户</span>: {user?.username || '未登录'}</p>
                <p>📋 <span className="font-medium">申请时间</span>: {user?.created_at ? new Date(user.created_at).toLocaleString('zh-CN') : '刚刚'}</p>
                <p>📋 <span className="font-medium">状态</span>: <span className="text-amber-400">⏳ 待审核</span></p>
              </div>

              <div className="mt-6 p-4 bg-white/5 border border-white/10 rounded-xl text-white/60 text-sm space-y-2">
                <p className="font-medium text-white/80">📞 加快审核</p>
                <p>• 微信: <span className="text-emerald-400 font-mono">HKmaipanren</span></p>
                <p>• 注明您的注册用户名</p>
                <p>• 提供购买凭证（群截图等）</p>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white text-sm hover:bg-white/15 transition"
                >
                  🔄 刷新状态
                </button>
                <Link
                  href="/login"
                  className="flex-1 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white/60 text-sm text-center hover:bg-white/10 transition"
                >
                  重新登录
                </Link>
              </div>
            </>
          )}

          <div className="mt-8 text-center text-xs text-white/30">
            申请 ID: {user?.id || 'N/A'}
          </div>
        </div>
      </div>
    </div>
  );
}
