'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// 2026-08-16 viewer-role: 双 tab 注册
//   - 'main' (默认): 邀请码注册 → basic 基础会员
//   - 'viewer_apply': 申请文档资源站 → viewer 待确认 (无邀请码也行)
export default function RegisterPage() {
  const [tab, setTab] = useState<'main' | 'viewer_apply'>('main');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [wechatName, setWechatName] = useState('');
  const [wechatId, setWechatId] = useState('');
  const [applicationReason, setApplicationReason] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaUrl, setCaptchaUrl] = useState('/api/captcha?' + Date.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const refreshCaptcha = () => {
    setCaptchaUrl('/api/captcha?' + Date.now());
    setCaptcha("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPwd) {
      setError('两次密码不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码至少6位');
      return;
    }

    const body: any = { username, password, captcha };
    if (tab === 'main') {
      if (!inviteCode.trim()) {
        setError('请输入邀请码（向客服索取）');
        return;
      }
      body.invite_code = inviteCode.trim();
      body.application_path = 'main';
    } else {
      if (!wechatName.trim() || !wechatId.trim()) {
        setError('请填写微信名和微信号（用于审核）');
        return;
      }
      body.wechat_name = wechatName.trim();
      body.wechat_id = wechatId.trim();
      body.application_reason = applicationReason.trim();
      body.application_path = 'viewer_apply';
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '注册失败');
        return;
      }

      // viewer pending: 跳 /pending-approval
      if (data.pending) {
        localStorage.setItem('viewer_pending_user', JSON.stringify(data.user));
        router.push('/pending-approval');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
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
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-pink-500 rounded-xl flex items-center justify-center">
              <span className="text-2xl">🎬</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">泽泽妈妈资源库</h1>
              <p className="text-sm text-white/40">注册账号</p>
            </div>
          </div>

          {/* 2026-08-16 viewer-role: Tab 切换 */}
          <div className="flex gap-2 mb-6 p-1 bg-white/5 rounded-xl">
            <button
              type="button"
              onClick={() => { setTab('main'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                tab === 'main'
                  ? 'bg-violet-500/30 text-violet-300'
                  : 'text-white/60 hover:text-white/80'
              }`}
            >
              🎟️ 邀请码注册
            </button>
            <button
              type="button"
              onClick={() => { setTab('viewer_apply'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                tab === 'viewer_apply'
                  ? 'bg-amber-500/30 text-amber-300'
                  : 'text-white/60 hover:text-white/80'
              }`}
            >
              📚 申请文档资源站
            </button>
          </div>

          {/* 提示文案 (跟 tab 联动) */}
          <div className="mb-5 text-xs text-white/40 leading-relaxed">
            {tab === 'main' ? (
              <span>邀请码注册即获 <span className="text-emerald-400">basic 基础会员</span>，可浏览全站资源（VIP 资源仅展示不可打开）</span>
            ) : (
              <span>无邀请码？申请文档资源站账号，审核通过后可浏览 <span className="text-amber-300">文档资源</span> + <span className="text-amber-300">个人主页</span>，<span className="text-red-400">不能浏览主站其他页面</span></span>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm text-white/60 mb-2">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="至少3位"
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
                placeholder="至少6位"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-2">确认密码</label>
              <input
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="再次输入密码"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
                required
              />
            </div>

            {/* main 路径: 邀请码 */}
            {tab === 'main' && (
              <div>
                <label className="block text-sm text-white/60 mb-2">
                  <span className="text-emerald-400">🎟️ 邀请码</span>
                  <span className="text-xs text-white/40 ml-2">向客服索取（如 INV-XXXX-XXXX-XXXX）</span>
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="INV-XXXX-XXXX-XXXX"
                  maxLength={20}
                  className="w-full bg-emerald-500/5 border border-emerald-500/30 rounded-xl px-4 py-3 text-white font-mono placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
                  required
                />
              </div>
            )}

            {/* viewer 申请路径: 微信必填 + 申请理由 */}
            {tab === 'viewer_apply' && (
              <>
                <div>
                  <label className="block text-sm text-white/60 mb-2">
                    <span className="text-amber-400">📱 微信名</span>
                    <span className="text-xs text-white/40 ml-2">购买/加群时的微信名（用于审核查核）</span>
                  </label>
                  <input
                    type="text"
                    value={wechatName}
                    onChange={(e) => setWechatName(e.target.value)}
                    placeholder="例：泽泽妈粉丝-X"
                    maxLength={100}
                    className="w-full bg-amber-500/5 border border-amber-500/30 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-2">
                    <span className="text-amber-400">📱 微信号</span>
                    <span className="text-xs text-white/40 ml-2">用于审核查核（保密处理）</span>
                  </label>
                  <input
                    type="text"
                    value={wechatId}
                    onChange={(e) => setWechatId(e.target.value)}
                    placeholder="例：wxid_abc123"
                    maxLength={100}
                    className="w-full bg-amber-500/5 border border-amber-500/30 rounded-xl px-4 py-3 text-white font-mono placeholder-white/30 focus:outline-none focus:border-amber-500/50"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-2">
                    <span className="text-white/60">📝 申请理由</span>
                    <span className="text-xs text-white/40 ml-2">选填，简介您的用途</span>
                  </label>
                  <textarea
                    value={applicationReason}
                    onChange={(e) => setApplicationReason(e.target.value)}
                    placeholder="例：学生，需要查阅文献资源..."
                    maxLength={500}
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50 resize-none"
                  />
                </div>
              </>
            )}

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
              disabled={loading}
              className={`w-full py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition ${
                tab === 'main'
                  ? 'bg-gradient-to-r from-violet-600 to-pink-600'
                  : 'bg-gradient-to-r from-amber-600 to-orange-600'
              }`}
            >
              {loading ? '提交中...' : tab === 'main' ? '注册' : '提交申请'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-white/40">
            已有账号？{' '}
            <Link href="/login" className="text-violet-400 hover:underline">
              登录
            </Link>
          </div>

          <div className="mt-4 text-center">
            <Link href="/activate" className="text-sm text-pink-400 hover:underline">
              已有激活码？点此升级 VIP →
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
