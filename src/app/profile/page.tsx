'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Crown, Calendar, Tag, Sparkles, ArrowRight, MessageCircle, ExternalLink, History, Home, AlertCircle, CheckCircle2, Coins, Unlock, FileLock } from 'lucide-react';

interface UserInfo {
  id: number;
  username: string;
  user_group: string;
  expire_at: string | null;
  status: string;
  created_at: string;
  last_login: string | null;
}

interface ActivationRecord {
  id: number;
  code: string;
  code_type: string;
  plan_id: string | null;
  duration: number;
  channel: string | null;
  batch_id: string | null;
  price_at_issue: number;
  used_at: string;
}

interface UnlockRecord {
  id: number;
  resource_id: number;
  resource_name: string | null;
  category: string | null;
  source: string | null;
  lumen_cost: number;
  unlocked_at: string;
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [records, setRecords] = useState<ActivationRecord[]>([]);
  const [unlocks, setUnlocks] = useState<UnlockRecord[]>([]);
  const [lumenBalance, setLumenBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
    if (!t) { router.push('/login?redirect=/profile'); return; }

    const fetchData = async () => {
      try {
        const r1 = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t, 'Cache-Control': 'no-cache' } });
        if (!r1.ok) { setError('请先登录'); setLoading(false); return; }
        const d1 = await r1.json();
        setUser(d1.user);
        const r2 = await fetch('/api/user/activations', { headers: { Authorization: 'Bearer ' + t } });
        if (r2.ok) { const d2 = await r2.json(); setRecords(d2.items || []); }
        const r3 = await fetch('/api/user/unlocks/list', { headers: { Authorization: 'Bearer ' + t } });
        if (r3.ok) { const d3 = await r3.json(); setUnlocks(d3.items || []); }
        const r4 = await fetch('/api/user/balance', { headers: { Authorization: 'Bearer ' + t } });
        if (r4.ok) { const d4 = await r4.json(); if (typeof d4.lumen_balance === 'number') setLumenBalance(d4.lumen_balance); }
      } catch (e: any) { setError(e.message); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [router]);

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">加载中...</div>;
  if (error || !user) return <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">{error || '未登录'}</div>;

  const isVip = ['vip', 'admin'].includes(user.user_group);
  const isBasic = user.user_group === 'basic';
  const isExpired = user.expire_at ? new Date(user.expire_at) < new Date() : false;
  const daysLeft = user.expire_at ? Math.max(0, Math.ceil((new Date(user.expire_at).getTime() - Date.now()) / 86400000)) : (isVip ? 9999 : 0);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">👤 我的账户</h1>
          <Link href="/" className="text-sm text-white/40 hover:text-white/80 inline-flex items-center gap-1">
            <Home className="w-3 h-3" /> 返回首页
          </Link>
        </div>

        {/* 2026-06-25: 流明余额卡 + 解锁记录卡 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6"
        >
          {/* 💎 流明余额 */}
          <div className="rounded-2xl p-5 border bg-gradient-to-br from-fuchsia-500/10 to-pink-500/10 border-fuchsia-500/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-white/60">💎 流明余额</span>
              <Coins className="w-4 h-4 text-fuchsia-400" />
            </div>
            <div className="text-3xl font-bold text-fuchsia-300 mb-2">{lumenBalance}</div>
            <div className="text-xs text-white/50 mb-3">
              {isVip ? 'VIP 可用流明直接解锁付费资源' : '基础会员暂不能解锁付费资源'}
            </div>
            <Link href="/activate" className="block w-full text-center px-3 py-2 bg-fuchsia-600/30 hover:bg-fuchsia-600/50 border border-fuchsia-500/40 rounded-lg text-sm text-fuchsia-200">
              🎫 兑换流明码 →
            </Link>
          </div>

          {/* 🔓 已解锁资源 */}
          <div className="rounded-2xl p-5 border bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-white/60">🔓 已解锁资源</span>
              <Unlock className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-bold text-emerald-300 mb-2">{unlocks.length}</div>
            <div className="text-xs text-white/50 mb-3">
              {unlocks.length > 0 ? `最近解锁: ${unlocks[0].resource_name?.slice(0, 20) || '#' + unlocks[0].resource_id}` : '尚无解锁记录'}
            </div>
            <Link href="/" className="block w-full text-center px-3 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 rounded-lg text-sm text-emerald-200">
              🎬 去搜索资源 →
            </Link>
          </div>
        </motion.div>

        {/* 2026-06-10: 续费提醒条 - 7天内到期 / 已过期 */}
        {isVip && isExpired && (
          <Link href="/activate" className="block mb-4 p-4 bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/40 rounded-xl hover:from-red-500/30 transition">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-3xl">⚠️</div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold text-red-300">您的 VIP 已过期</div>
                <div className="text-xs text-white/60 mt-0.5">于 {new Date(user.expire_at!).toLocaleDateString('zh-CN')} 到期 · 续费立即恢复全部权限</div>
              </div>
              <div className="px-4 py-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-lg text-sm font-medium whitespace-nowrap">🔄 立即续费</div>
            </div>
          </Link>
        )}
        {isVip && !isExpired && daysLeft > 0 && daysLeft <= 7 && (
          <Link href="/activate" className="block mb-4 p-4 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40 rounded-xl hover:from-amber-500/30 transition">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-3xl">⏰</div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold text-amber-300">VIP 将在 {daysLeft} 天后到期</div>
                <div className="text-xs text-white/60 mt-0.5">续费半年/年卡享优惠 · 避免过期影响使用</div>
              </div>
              <div className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 rounded-lg text-sm font-medium whitespace-nowrap">🔄 提前续费</div>
            </div>
          </Link>
        )}
        {isVip && !isExpired && daysLeft > 7 && daysLeft <= 30 && (
          <Link href="/activate" className="block mb-4 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span>💡</span>
              <span className="text-white/60">VIP 剩余 <b className="text-white">{daysLeft}</b> 天</span>
              <span className="ml-auto text-violet-300">续费 →</span>
            </div>
          </Link>
        )}

        {/* 会员状态卡 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl p-6 border mb-6 ${
            isVip && !isExpired
              ? 'bg-gradient-to-br from-violet-500/10 to-pink-500/10 border-violet-500/30'
              : isBasic || isVip
                ? 'bg-gradient-to-br from-sky-500/10 to-blue-500/10 border-sky-500/30'
                : 'bg-[#12121a] border-white/5'
          }`}
        >
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm text-white/60 mb-1">会员等级</div>
              <div className="flex items-center gap-2">
                {isVip && !isExpired && <Crown className="w-5 h-5 text-amber-400" />}
                {isBasic && <Sparkles className="w-5 h-5 text-sky-400" />}
                {!isVip && !isBasic && <Tag className="w-5 h-5 text-white/60" />}
                <span className="text-2xl font-bold">
                  {isVip && !isExpired ? 'VIP 会员' : isExpired ? '已过期' : isBasic ? '基础会员' : '普通用户'}
                </span>
              </div>
              {user.expire_at && (
                <div className="text-sm text-white/60 mt-2">
                  {isExpired ? '已到期于' : '到期时间'}:
                  <span className={`ml-2 font-mono ${isExpired ? 'text-red-400' : 'text-emerald-400'}`}>
                    {new Date(user.expire_at).toLocaleString('zh-CN')}
                  </span>
                </div>
              )}
              {isVip && !isExpired && (
                <div className="text-sm text-amber-300 mt-1">
                  剩余 <b className="font-bold">{daysLeft === 9999 ? '永久' : daysLeft + ' 天'}</b>
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs text-white/40">用户名</div>
              <div className="font-mono text-violet-300">{user.username}</div>
              <div className="text-xs text-white/40 mt-2">注册时间</div>
              <div className="text-xs text-white/60">{new Date(user.created_at).toLocaleDateString('zh-CN')}</div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="mt-5 flex flex-wrap gap-2">
            {!isVip || isExpired ? (
              <Link href="/activate" className="px-4 py-2 bg-gradient-to-r from-violet-600 to-pink-600 rounded-lg text-sm font-medium inline-flex items-center gap-1 hover:opacity-90">
                <Sparkles className="w-3 h-3" /> 兑换激活码
              </Link>
            ) : (
              <Link href="/activate" className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium inline-flex items-center gap-1">
                续费 VIP <ArrowRight className="w-3 h-3" />
              </Link>
            )}
            <Link href="/tmdb-films" className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium">去影视区</Link>
            <a href="https://t.me/ziyuankefuqun" target="_blank" rel="noopener" className="px-4 py-2 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 rounded-lg text-sm font-medium text-sky-300 inline-flex items-center gap-1">
              <MessageCircle className="w-3 h-3" /> 联系客服
            </a>
          </div>
        </motion.div>

        {/* 兑换记录 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-400" /> 兑换记录
          </h2>
          {records.length === 0 ? (
            <div className="text-center py-8 text-white/40 text-sm">暂无兑换记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/40 text-xs border-b border-white/5">
                    <th className="py-2">时间</th>
                    <th className="py-2">类型</th>
                    <th className="py-2">套餐</th>
                    <th className="py-2">渠道</th>
                    <th className="py-2">价格</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 text-white/60 text-xs">{new Date(r.used_at).toLocaleString('zh-CN')}</td>
                      <td className="py-2">{r.code_type === 'vip' ? (r.duration === 0 ? '永久' : `${r.duration}天`) : r.code_type}</td>
                      <td className="py-2 font-mono text-violet-300 text-xs">{r.plan_id || '-'}</td>
                      <td className="py-2">{r.channel === 'wd' ? '🏪' : r.channel === 'xy' ? '🐟' : '-'}</td>
                      <td className="py-2">¥{r.price_at_issue || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 2026-06-25 解锁记录 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FileLock className="w-5 h-5 text-emerald-400" /> 我的解锁记录
            <span className="text-sm text-white/40 font-normal">（{unlocks.length} 条）</span>
          </h2>
          {unlocks.length === 0 ? (
            <div className="text-center py-8 text-white/40 text-sm">
              尚无解锁记录 · 在首页搜索资源时点击 <span className="text-violet-300">解锁</span> 按钮
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/40 text-xs border-b border-white/5">
                    <th className="py-2">解锁时间</th>
                    <th className="py-2">资源</th>
                    <th className="py-2">分类</th>
                    <th className="py-2">来源</th>
                    <th className="py-2">消耗流明</th>
                  </tr>
                </thead>
                <tbody>
                  {unlocks.slice(0, 30).map(u => (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 text-white/60 text-xs">{new Date(u.unlocked_at).toLocaleString('zh-CN')}</td>
                      <td className="py-2">
                        <Link href={`/tmdb-films/${u.resource_id}`} className="text-violet-300 hover:underline">
                          {u.resource_name?.slice(0, 30) || `#${u.resource_id}`}
                        </Link>
                      </td>
                      <td className="py-2 text-xs text-white/60">{u.category || '-'}</td>
                      <td className="py-2 text-xs">{u.source || '-'}</td>
                      <td className="py-2 text-fuchsia-300">💎 {u.lumen_cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 客服 + 规则 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
          <h2 className="text-lg font-semibold mb-4">💬 客服与说明</h2>
          <div className="space-y-3 text-sm text-white/70">
            <div className="flex items-start gap-2">
              <MessageCircle className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
              <div>
                <b className="text-white">Telegram 群:</b>
                <a href="https://t.me/ziyuankefuqun" target="_blank" rel="noopener" className="text-sky-400 hover:underline ml-1">
                  泽泽客服群
                </a>
                <div className="text-xs text-white/40 mt-0.5">客服 9:00-23:00 在线 / 闪退问题找群主</div>
              </div>
            </div>
            <div className="pt-3 border-t border-white/5 text-xs text-white/40 leading-relaxed">
              <div className="flex items-start gap-1.5 mb-1">
                <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span>本站所有资源仅供个人学习交流，<b>24 小时内</b>联系客服可申请删除</span>
              </div>
              <Link href="/terms" className="text-violet-400 hover:underline inline-flex items-center gap-0.5">
                阅读完整服务条款 <ExternalLink className="w-2.5 h-2.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
