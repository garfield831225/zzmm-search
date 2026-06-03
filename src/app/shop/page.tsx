'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

export default function ShopPage() {
  const router = useRouter();
  const [logged, setLogged] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem('token');
    setLogged(!!t);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* 顶部返回 */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white/70 transition"
          >
            ← 返回
          </button>
          {!logged && (
            <button
              onClick={() => router.push('/login')}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm transition"
            >
              登录 / 注册
            </button>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#12121a] rounded-2xl p-6 md:p-10 border border-white/5"
        >
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🛒</div>
            <h1 className="text-2xl md:text-3xl font-bold">激活码购买</h1>
            <p className="text-sm text-white/40 mt-2">单资源一次性解锁 · 8 位激活码</p>
          </div>

          {/* 购买流程 */}
          <div className="grid md:grid-cols-3 gap-4 mb-8">
            <div className="bg-white/5 rounded-xl p-5 border border-white/5">
              <div className="text-2xl mb-2">1️⃣</div>
              <h3 className="font-semibold mb-1">挑选资源</h3>
              <p className="text-xs text-white/50">在资源详情页看到 💰 徽章的资源可购买</p>
            </div>
            <div className="bg-white/5 rounded-xl p-5 border border-white/5">
              <div className="text-2xl mb-2">2️⃣</div>
              <h3 className="font-semibold mb-1">扫码支付</h3>
              <p className="text-xs text-white/50">联系站长微信 / 支付宝转账</p>
            </div>
            <div className="bg-white/5 rounded-xl p-5 border border-white/5">
              <div className="text-2xl mb-2">3️⃣</div>
              <h3 className="font-semibold mb-1">获取激活码</h3>
              <p className="text-xs text-white/50">站长发送 8 位码，回到 /activate 兑换</p>
            </div>
          </div>

          {/* 联系方式 */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="bg-gradient-to-br from-green-600/10 to-emerald-600/10 border border-green-500/20 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">💬</span>
                <h3 className="font-semibold text-green-300">微信支付</h3>
              </div>
              <p className="text-sm text-white/70 mb-2">添加站长微信（HK 麦盘人）</p>
              <div className="bg-black/30 rounded-lg p-3 text-center">
                <code className="text-lg font-mono text-green-300">HK_Maipan_ZeZe</code>
              </div>
              <p className="text-xs text-white/40 mt-2">备注：泽泽妈妈资源 + 资源名</p>
            </div>
            <div className="bg-gradient-to-br from-blue-600/10 to-cyan-600/10 border border-blue-500/20 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">💰</span>
                <h3 className="font-semibold text-blue-300">支付宝</h3>
              </div>
              <p className="text-sm text-white/70 mb-2">扫码转账（截图发给站长）</p>
              <div className="bg-black/30 rounded-lg p-3 text-center">
                <code className="text-lg font-mono text-blue-300">hk_maipan@163.com</code>
              </div>
              <p className="text-xs text-white/40 mt-2">备注：泽泽妈妈资源 + 资源名</p>
            </div>
          </div>

          {/* 价格说明 */}
          <div className="bg-white/5 rounded-xl p-5 mb-6">
            <h3 className="font-semibold mb-3 text-amber-300">💡 购买说明</h3>
            <ul className="space-y-2 text-sm text-white/70">
              <li>• 资源价格由资源详情页显示（¥0.1 - ¥99 不等）</li>
              <li>• 激活码<strong className="text-amber-300">绑定具体资源</strong>，一个码只能解锁一个资源</li>
              <li>• 激活码<strong className="text-amber-300">一次性使用</strong>，使用后失效</li>
              <li>• 资源失效（链接 404）可联系站长补发新码</li>
              <li>• 批量购买（≥10 个）享 9 折优惠</li>
            </ul>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => router.push('/')}
              className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl transition"
            >
              继续浏览资源
            </button>
            <button
              onClick={() => router.push('/activate')}
              className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-semibold hover:opacity-90 transition"
            >
              去激活 →
            </button>
          </div>
        </motion.div>

        <p className="text-center text-xs text-white/30 mt-6">
          有问题？联系站长微信 HK_Maipan_ZeZe
        </p>
      </div>
    </div>
  );
}
