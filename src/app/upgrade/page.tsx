'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Crown, Clock, Infinity, Sparkles, Tag, ArrowRight, Home, Store, Check } from 'lucide-react';

// 2026-07-29 全站闲鱼 VIP 购买引导页
// 替换原 /shop (单资源购买) 作为 VIP 升级入口
// 设计:
//   - 顶部 banner: 商品标题 + 9 大云盘
//   - 4 个时长说明 (月/季/年/永久)
//   - 主按钮: 跳闲鱼商品链接 (1 条 + 多个 SPU)
//   - 副按钮: 跳闲鱼店铺
//   - 流程说明: 闲鱼下单 → 拿激活码 → /activate 兑换

const SHOP_PRODUCT_URL = 'https://m.tb.cn/h.83JDFcd?tk=0ZuHgET6kFS';
const SHOP_STORE_URL = 'https://m.tb.cn/h.8WtUS7Z?tk=qNj9gET60wz';

const PLANS = [
  { key: 'month', label: '月度', price: '¥15', days: 30, color: 'from-cyan-500 to-blue-600', badge: '', desc: '体验' },
  { key: 'season', label: '季度', price: '¥40', days: 90, color: 'from-violet-500 to-purple-600', badge: '', desc: '划算' },
  { key: 'year', label: '年度', price: '¥150', days: 365, color: 'from-pink-500 to-rose-600', badge: '热销', desc: '超值' },
  { key: 'forever', label: '永久', price: '¥388', days: 0, color: 'from-amber-500 to-orange-600', badge: '至尊', desc: '终身' },
];

const CLOUDS = ['115 网盘', '百度网盘', '夸克网盘', '阿里云盘', '迅雷', 'UC', '天翼云盘', '123 网盘', '移动云'];

export default function UpgradePage() {
  const router = useRouter();
  const [logged, setLogged] = useState(false);
  const [userGroup, setUserGroup] = useState<string>('user');

  useEffect(() => {
    const t = localStorage.getItem('token');
    setLogged(!!t);
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u.group) setUserGroup(String(u.group).toLowerCase());
    } catch {}
  }, []);

  const isVip = userGroup === 'vip' || userGroup === 'admin';

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white relative overflow-hidden">
      {/* 背景动效 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-6 md:py-10">
        {/* 顶部返回 */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white/70 transition inline-flex items-center gap-1"
          >
            ← 返回
          </button>
          {!logged ? (
            <Link
              href="/login"
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm transition"
            >
              登录 / 注册
            </Link>
          ) : (
            <Link
              href="/profile"
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white/70 transition"
            >
              👤 我的
            </Link>
          )}
        </div>

        {/* VIP 用户的特殊提示 */}
        {isVip && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-xl text-amber-200 text-sm flex items-start gap-2"
          >
            <Crown className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">您已经是 VIP 会员</div>
              <div className="text-xs text-amber-300/70 mt-1">如需续费，请到闲鱼选 SPU 下单</div>
            </div>
          </motion.div>
        )}

        {/* 头部 banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-amber-500/20 border border-amber-500/30 rounded-full text-amber-300 text-xs mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>邀约制 · 不断更新 · 9 大云盘</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3 bg-gradient-to-r from-amber-300 via-pink-300 to-violet-300 bg-clip-text text-transparent">
            升级 VIP 会员
          </h1>
          <p className="text-sm md:text-base text-white/60 max-w-xl mx-auto">
            邀请码注册即为基础会员，可正常浏览全站资源<br />
            VIP 资源需升级会员后解锁（<span className="text-amber-300">11,793+ 部影视</span> + <span className="text-pink-300">海量非影视</span>）
          </p>
        </motion.div>

        {/* 4 个时长卡 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {PLANS.map((p, i) => (
            <motion.div
              key={p.key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="relative bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-white/30 transition group"
            >
              {p.badge && (
                <span className="absolute -top-2 right-2 px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-black text-[10px] rounded-full font-bold">
                  {p.badge}
                </span>
              )}
              <div className={`w-10 h-10 mb-3 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center`}>
                {p.days === 0 ? <Infinity className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
              </div>
              <div className="text-xs text-white/40">{p.label}</div>
              <div className="text-2xl font-bold mt-1">{p.price}</div>
              <div className="text-xs text-white/50 mt-1">
                {p.days === 0 ? '终身' : `${p.days} 天`}
              </div>
              <div className="text-[10px] text-white/30 mt-1">{p.desc}</div>
            </motion.div>
          ))}
        </div>

        {/* 主操作卡 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-gradient-to-br from-amber-500/10 via-pink-500/10 to-violet-500/10 border border-white/10 rounded-2xl p-6 md:p-8 mb-6"
        >
          {/* 标题 */}
          <div className="flex items-center gap-3 mb-4">
            <div className="text-4xl">🛒</div>
            <div>
              <div className="font-bold text-lg">闲鱼下单</div>
              <div className="text-xs text-white/50">单商品链接 · 多个 SPU（自选时长）</div>
            </div>
          </div>

          {/* 商品亮点 */}
          <div className="bg-black/30 rounded-xl p-4 mb-4">
            <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-amber-300" />
              <span>商品标题：</span>
            </div>
            <div className="text-amber-200 text-sm leading-relaxed">
              【文档会员专用】全网最全资源 9大云盘 不断更新【邀约制】
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {CLOUDS.map((c) => (
                <span key={c} className="px-2 py-0.5 bg-white/5 text-white/60 text-[10px] rounded">
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* 主按钮 */}
          <a
            href={SHOP_PRODUCT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full block text-center py-4 bg-gradient-to-r from-amber-500 via-orange-500 to-pink-500 text-black font-bold rounded-xl text-lg hover:opacity-90 transition shadow-lg shadow-amber-500/20"
          >
            🐟 前往闲鱼选购
          </a>

          {/* 副按钮 */}
          <a
            href={SHOP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full mt-3 block text-center py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm transition inline-flex items-center justify-center gap-2"
          >
            <Store className="w-4 h-4" />
            逛逛我的闲鱼店
          </a>
        </motion.div>

        {/* 购买流程 */}
        <div className="bg-[#12121a] border border-white/5 rounded-2xl p-5 mb-6">
          <h3 className="font-bold mb-4 flex items-center gap-2">
            <span>📋</span>
            <span>购买流程</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              { icon: '1️⃣', title: '选 SPU', desc: '闲鱼商品页选时长' },
              { icon: '2️⃣', title: '闲鱼下单', desc: '在线支付完成' },
              { icon: '3️⃣', title: '拿激活码', desc: '卖家发激活码' },
              { icon: '4️⃣', title: '兑换生效', desc: '到 /activate 兑换' },
            ].map((s) => (
              <div key={s.icon} className="bg-white/5 rounded-xl p-3">
                <div className="text-2xl mb-1">{s.icon}</div>
                <div className="font-medium text-sm">{s.title}</div>
                <div className="text-xs text-white/40 mt-1">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 兑换入口 */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <div className="text-2xl">🎫</div>
            <div className="flex-1">
              <h3 className="font-bold mb-1">已有激活码？</h3>
              <p className="text-sm text-white/50 mb-3">闲鱼购买后卖家会发送 8 位激活码，复制后到兑换页粘贴</p>
              <Link
                href="/activate"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-violet-600 to-pink-600 hover:opacity-90 rounded-lg text-sm font-medium transition"
              >
                <Sparkles className="w-4 h-4" />
                立即兑换
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>

        {/* 优势说明 */}
        <div className="grid md:grid-cols-2 gap-3 mb-6">
          {[
            { icon: '✅', title: '激活码绑定账号', desc: '同一账号多次购买会自动延长 VIP 时长' },
            { icon: '✅', title: '全站资源解锁', desc: 'VIP 影视区 + 9 大云盘非影视区全开' },
            { icon: '✅', title: '失效补发', desc: '资源链接失效可联系卖家补发' },
            { icon: '✅', title: '每周免费额度', desc: 'VIP 每周 1 个资源免费解锁（不耗流明）' },
          ].map((b) => (
            <div key={b.title} className="flex items-start gap-2 bg-white/5 rounded-xl p-3">
              <span className="text-lg flex-shrink-0">{b.icon}</span>
              <div>
                <div className="text-sm font-medium">{b.title}</div>
                <div className="text-xs text-white/40 mt-0.5">{b.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 2026-07-31: 流明套餐移到最下面 (失效补发 + 每周免费额度 之后) - 用户选定 */}
        <div id="lumen" className="bg-gradient-to-br from-amber-500/10 via-yellow-500/10 to-amber-500/5 border border-amber-500/20 rounded-2xl p-5 md:p-6 mb-6 scroll-mt-20">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center text-2xl">
              💰
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-bold text-lg">流明套餐</h2>
                <span className="px-2 py-0.5 bg-amber-500/20 text-amber-200 text-[10px] rounded-full">单资源付费</span>
              </div>
              <p className="text-xs text-white/50">解锁单条付费资源（资源详情页带 💰 徽章的）</p>
            </div>
          </div>

          <div className="bg-black/30 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-2xl font-bold text-amber-300">¥2 = 10 流明</div>
                <div className="text-[10px] text-white/40 mt-0.5">每个流明 ≈ 0.2 元 · 单资源 1-10 流明解锁</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-white/60">举例</div>
                <div className="text-[10px] text-white/40 mt-0.5">5 流明解锁 1 条资源 = 1 元</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
            <div className="bg-white/5 rounded-lg p-2.5 text-center">
              <div className="text-white/40 mb-0.5">什么资源</div>
              <div className="font-medium text-amber-200">💰 单条付费</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2.5 text-center">
              <div className="text-white/40 mb-0.5">怎么用</div>
              <div className="font-medium">解锁扣流明</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2.5 text-center">
              <div className="text-white/40 mb-0.5">有效期</div>
              <div className="font-medium">1 年</div>
            </div>
          </div>

          <a
            href={SHOP_PRODUCT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full block text-center py-3 bg-gradient-to-r from-amber-500 to-yellow-500 text-black font-bold rounded-xl hover:opacity-90 transition"
          >
            🐟 前往闲鱼买流明
          </a>
        </div>

        <div className="text-center text-xs text-white/30">
          有问题？联系站长微信 <span className="font-mono text-white/50">HKmaipanren</span>
        </div>
      </div>
    </div>
  );
}
