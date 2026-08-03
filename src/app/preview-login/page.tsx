'use client';
// 2026-08-04: P7 Preview 免登录 auto-inject 客户端
//   - 进 /preview-login 自动调 /api/preview-login?key=PREVIEW_KEY
//   - 把 token + user 写到 localStorage
//   - 跳 /admin (或 ?redirect=xxx 指定)
//
// 用法:
//   浏览器打开 http://preview.zzmmemby.cn/preview-login
//   → 自动签 admin token, 跳 /admin
//
// ⚠️ useSearchParams 必须包 Suspense, 否则 build 报 prerender error

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function PreviewLoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [msg, setMsg] = useState('正在注入 admin token...');
  const [user, setUser] = useState<{ id: number; username: string; user_group: string } | null>(null);

  useEffect(() => {
    const PREVIEW_KEY = 'preview-zzmm-2026';  // 跟 .env.production PREVIEW_KEY 一致
    const redirect = params.get('redirect') || '/admin';

    (async () => {
      try {
        const r = await fetch('/api/preview-login?key=' + encodeURIComponent(PREVIEW_KEY));
        const d = await r.json();
        if (!r.ok || !d.success) {
          setStatus('error');
          setMsg(d.error || '注入失败 (HTTP ' + r.status + ')');
          return;
        }
        // 写入 localStorage (3 个 key, 跟正常登录保持一致)
        localStorage.setItem('zzmm_token', d.token);
        localStorage.setItem('token', d.token);
        localStorage.setItem('user', JSON.stringify(d.user));
        setUser(d.user);
        setStatus('success');
        setMsg(`✅ 已注入 admin token (${d.user.username}), 跳转中...`);
        setTimeout(() => router.push(redirect), 600);
      } catch (e: any) {
        setStatus('error');
        setMsg('网络错误: ' + e.message);
      }
    })();
  }, [router, params]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/[0.04] to-blue-500/[0.04] p-6">
        <div className="text-2xl font-bold mb-2">
          {status === 'loading' && '⚡ Preview Login'}
          {status === 'success' && '✅ 已登录'}
          {status === 'error' && '❌ 失败'}
        </div>
        <div className="text-sm text-white/70 mb-4">{msg}</div>
        {user && (
          <div className="text-xs bg-black/30 rounded-lg p-3 mb-3 font-mono">
            <div>id: {user.id}</div>
            <div>username: {user.username}</div>
            <div>user_group: {user.user_group}</div>
          </div>
        )}
        {status === 'error' && (
          <button
            onClick={() => location.reload()}
            className="w-full py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium">
            重试
          </button>
        )}
        {status === 'success' && (
          <div className="text-[10px] text-white/40 mt-2">
            (这个页面只在 APP_ENV=preview 才生效, 生产环境返 403)
          </div>
        )}
      </div>
    </div>
  );
}

export default function PreviewLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        加载中...
      </div>
    }>
      <PreviewLoginInner />
    </Suspense>
  );
}
