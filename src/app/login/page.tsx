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
  const imgRef = useRef<HTMLImageElement>(null);
  const router = useRouter();

  const refreshCaptcha = () => {
    setCaptchaUrl('/api/captcha?' + Date.now());
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

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
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