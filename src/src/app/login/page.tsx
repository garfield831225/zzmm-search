'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, captcha }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '操作失败');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message);
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
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🎬</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">泽泽妈妈资源库</h1>
          <p className="text-white/60 text-sm">海量资源 一站搜索</p>
        </div>

        {/* Form */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
          {/* Tabs */}
          <div className="flex mb-6 bg-white/5 rounded-xl p-1">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                mode === 'login' ? 'bg-violet-600 text-white' : 'text-white/60'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                mode === 'register' ? 'bg-violet-600 text-white' : 'text-white/60'
              }`}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-sm text-white/60 mb-1.5">用户名</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500 transition"
                  placeholder="设置用户名"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-white/60 mb-1.5">
                {mode === 'login' ? '用户名或邮箱' : '邮箱'}
              </label>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500 transition"
                placeholder={mode === 'login' ? '用户名或邮箱' : '用于登录和找回密码'}
                required
              />
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500 transition"
                placeholder="设置密码"
                required
                minLength={6}
              />
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-1.5">验证码</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={captcha}
                  onChange={(e) => setCaptcha(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500 transition"
                  placeholder="输入图形验证码"
                  required
                />
                <button
                  type="button"
                  className="px-4 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition"
                >
                  <img src="/api/captcha" alt="验证码" className="h-10" />
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-medium disabled:opacity-50 transition hover:opacity-90"
            >
              {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
            </button>
          </form>

          {/* Activation Code */}
          {mode === 'login' && (
            <div className="mt-6 pt-6 border-t border-white/5">
              <p className="text-center text-sm text-white/40 mb-3">已有激活码？</p>
              <Link
                href="/activate"
                className="block w-full py-2 text-center text-pink-400 hover:text-pink-300 transition"
              >
                输入激活码 →
              </Link>
            </div>
          )}
        </div>

        {/* Contact */}
        <p className="text-center text-white/40 text-sm mt-6">
          遇到问题？联系微信：<span className="text-pink-400">HKmaipanren</span>
        </p>
      </motion.div>
    </div>
  );
}