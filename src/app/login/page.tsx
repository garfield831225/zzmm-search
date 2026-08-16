'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaUrl, setCaptchaUrl] = useState('/api/captcha?' + Date.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentUser, setCurrentUser] = useState<{ username: string; group: string } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const router = useRouter();

  // 2026-07-29: 监听 kicked / account_disabled query param
  // middleware 单点登录检测到旧 token 失效时, 跳 /login?kicked=1
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('kicked') === '1') {
      setError('您的账号已在另一设备登录，已自动登出。如非本人操作，请尽快修改密码。');
    } else if (params.get('error') === 'account_disabled') {
      setError('账号已被禁用，请联系客服。');
    }
  }, []);

  // 2026-07-17: 只查"是否已登录"用于顶部提示，**绝不自动跳转**
  // 之前自动跳转导致换帐号不可能，必须让用户能重新填表
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        if (r.ok) {
          const d = await r.json();
          if (d.user) {
            setCurrentUser({ username: d.user.username, group: d.user.user_group });
            // 同步到 localStorage (让 admin/layout 等能立即读到)
            if (d.token) {
              localStorage.setItem('token', d.token);
              localStorage.setItem('zzmm_token', d.token);
            }
            if (d.user) {
              localStorage.setItem('user', JSON.stringify({
                id: d.user.id, username: d.user.username,
                group: d.user.user_group, expire_at: d.user.expire_at,
              }));
            }
          }
        }
      } catch {}
    };
    check();
  }, []);

  const handleLogoutAndStay = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
    localStorage.removeItem('token');
    localStorage.removeItem('zzmm_token');
    localStorage.removeItem('adminToken');
    localStorage.removeItem('user');
    setCurrentUser(null);
    setUsername('');
    setPassword('');
  };

  const refreshCaptcha = () => {
    setCaptchaUrl('/api/captcha?' + Date.now());
    setCaptcha(""); // 2026-07-14: 修法 A, 点图片刷新时清空 input, 避免旧码错配新 cookie
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, captcha }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '登录失败');
        refreshCaptcha();
        return;
      }

      // 2026-08-16 viewer-role: pending 用户跳 /pending-approval
      if (data.pending) {
        localStorage.setItem('viewer_pending_user', JSON.stringify(data.user));
        router.push('/pending-approval');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      // 2026-07-20: 同步 zzmm_token, 让 admin 子页面 (老代码) 也能读
      localStorage.setItem('zzmm_token', data.token);
      // 同步设置 adminToken，让管理后台能自动读取
      localStorage.setItem('adminToken', data.token);
      router.push('/');
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-[#12121a] rounded-2xl p-8 border border-white/5">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-pink-500 rounded-xl flex items-center justify-center">
              <span className="text-2xl">🎬</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">泽泽妈妈资源库</h1>
              <p className="text-sm text-white/40">登录账号</p>
            </div>
          </div>

          {/* 2026-07-17: 已登录提示 + 切换账号按钮 */}
          {currentUser && (
            <div className="mb-5 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs">
              <div className="text-amber-200 mb-1">
                当前已登录为 <b>{currentUser.username}</b> ({currentUser.group})
              </div>
              <div className="text-white/50 mb-2">想换账号？先点下面退出，再填新账号密码</div>
              <button
                type="button"
                onClick={handleLogoutAndStay}
                className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded text-xs transition"
              >
                🚪 退出当前账号
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm text-white/60 mb-2">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-2">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-2">验证码</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={captcha}
                  onChange={(e) => setCaptcha(e.target.value.toLowerCase())}
                  placeholder="输入图形验证码"
                  maxLength={4}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 tracking-widest text-center uppercase"
                  required
                />
                <img
                  ref={imgRef}
                  src={captchaUrl}
                  alt="验证码"
                  onClick={refreshCaptcha}
                  className="w-28 h-11 rounded-xl cursor-pointer hover:opacity-80 transition"
                  style={{ background: '#1a1a2e', objectFit: 'fill' }}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !captcha}
              className="w-full py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-white/40">
            还没有账号？{' '}
            <Link href="/register" className="text-violet-400 hover:underline">
              注册账号
            </Link>
          </div>

          <div className="mt-4 text-center">
            <Link href="/activate" className="text-sm text-pink-400 hover:underline">
              激活会员卡 →
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}