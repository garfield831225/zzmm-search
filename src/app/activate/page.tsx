'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';

export default function ActivatePage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [unlockedResource, setUnlockedResource] = useState<{ id: number; name: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    // 检查是否已登录
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
    }
  }, [router]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/user/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '激活失败');
        return;
      }

      setSuccess(true);
      setUnlockedResource(data.resource || { id: 0, name: data.resource_name || '已解锁资源' });
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
              <span className="text-2xl">🎫</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">资源激活码</h1>
              <p className="text-sm text-white/40">8 位码 · 单资源一次性解锁</p>
            </div>
          </div>

          {success ? (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center py-8"
            >
              <div className="text-6xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold text-green-400 mb-2">激活成功！</h2>
              <p className="text-white/60 mb-4">已解锁资源：<br/><span className="text-violet-400 font-bold text-base">{unlockedResource?.name || '已解锁资源'}</span></p>
              <button
                onClick={() => unlockedResource?.id ? router.push(`/?unlock=${unlockedResource.id}`) : router.push('/')}
                className="mt-3 mx-1 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm transition"
              >
                继续浏览
              </button>
              <button
                onClick={() => router.push(`/resource/${unlockedResource?.id}`)}
                className="mt-3 mx-1 px-6 py-3 bg-violet-600 rounded-xl hover:opacity-90 transition"
              >
                查看资源详情
              </button>
              <button
                onClick={() => router.push('/')}
                className="mt-6 px-6 py-3 bg-violet-600 rounded-xl hover:opacity-90 transition"
              >
                返回首页
              </button>
            </motion.div>
          ) : (
            <>
              <form onSubmit={handleActivate} className="space-y-5">
                <div>
                  <label className="block text-sm text-white/60 mb-2">资源激活码（8 位）</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
                    placeholder="例如：ZM3K9X7P"
                    maxLength={8}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 font-mono tracking-widest text-center text-lg"
                    required
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || code.length !== 8}
                  className="w-full py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
                >
                  {loading ? '激活中...' : '立即激活'}
                </button>
              </form>

              <div className="mt-6 text-center text-sm text-white/40">
                没有激活码？
              </div>
              <button
                onClick={() => router.push('/shop')}
                className="mt-3 w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
              >
                <span>🛒</span>
                <span>立即购买</span>
              </button>
              <div className="mt-4 text-center text-xs text-white/30">
                提示：激活码绑定具体资源，可在资源详情页输入
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}