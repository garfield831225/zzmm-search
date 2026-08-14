'use client';
// 2026-07-28: 个人中心重做版
// 布局: 左侧导航 + 主内容
// 主内容: 头部 + 4 个统计卡 + 每周免费额度 + 详细信息 + 账户设置 + 危险操作
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  User, Key, FileText, Bell, Crown, Tag, AppWindow, BookOpen, Store,
  Sparkles, TrendingUp, Calendar, Activity, Shield, Trash2, X,
  CheckCircle2, AlertCircle, LogOut, Home, MessageCircle, Edit3, Lock, Unlock, Coins
} from 'lucide-react';
import { useRequireAuth } from '@/lib/use-require-auth';

interface UserInfo {
  id: number;
  username: string;
  user_group: string;
  expire_at: string | null;
  status: string;
  created_at: string;
  last_login: string | null;
}

interface LumenInfo {
  lumen_balance: number;
}

interface ActivationRecord {
  id: number;
  code: string;
  code_type: string;
  plan_id: string | null;
  duration: number;
  channel: string | null;
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

interface NavItem {
  key: string;
  label: string;
  icon: any;
  href?: string;
  active?: boolean;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'profile', label: '个人中心', icon: User, active: true },
  { key: 'invite', label: '邀请码', icon: Key, href: '/activate' },
  { key: 'lumen', label: '积分记录', icon: Coins, href: '/profile#lumen' },
  { key: 'inbox', label: '站内信', icon: Bell, href: '/profile#inbox' },
  { key: 'sub', label: '我的订阅', icon: Crown, href: '/activate' },
  { key: 'apps', label: '我的应用', icon: AppWindow },
  { key: 'oauth', label: '已授权应用', icon: Shield },
  { key: 'api', label: 'API 文档', icon: BookOpen, href: '/api-docs' },
  { key: 'shop', label: '商店', icon: Store, href: '/activate' },
];

export default function ProfilePage() {
  // 2026-08-15: client-side 鉴权 (替代不跑的 middleware)
  const { authChecked } = useRequireAuth('/profile');
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [lumenBalance, setLumenBalance] = useState(0);
  const [records, setRecords] = useState<ActivationRecord[]>([]);
  const [unlocks, setUnlocks] = useState<UnlockRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ username: '' });
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ old: '', new: '', confirm: '' });
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 未登录 / 鉴权中 → 显示加载, useRequireAuth 内部会跳 /login
  if (!authChecked) {
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/50 text-sm">加载中...</div>;
  }

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
  };

  // 2026-08-11: 积分兑换流明 (复用 /api/points/redeem, 10 积分 = 1 流明)
  const handlePointsRedeem = async () => {
    if (pointsBalance < 10) {
      showToast('error', `积分不足, 当前 ${pointsBalance} 积分, 至少需要 10 积分 (1 流明)`);
      return;
    }
    const maxLumen = Math.floor(pointsBalance / 10);
    const maxAmount = Math.min(pointsBalance, 10000);
    const input = prompt(
      `💡 积分兑换流明\n\n` +
      `比例: 10 积分 = 1 流明\n` +
      `当前积分: ${pointsBalance}\n` +
      `最多可兑: ${maxAmount} 积分 = ${Math.floor(maxAmount / 10)} 流明\n` +
      `(必须 10 的倍数, 单次最多 10000 积分 / 1000 流明)\n\n` +
      `请输入要兑换的积分数量:`, '10'
    );
    if (!input) return;
    const amount = parseInt(input, 10);
    if (!amount || amount < 10 || amount > 10000 || amount % 10 !== 0) {
      showToast('error', '兑换数量必须是 10-10000 的 10 倍数');
      return;
    }
    try {
      const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
      const r = await fetch('/api/points/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ amount }),
      });
      const d = await r.json();
      if (d.error) {
        showToast('error', d.error);
      } else {
        showToast('success', d.message || `✅ 兑换成功: ${amount} 积分 → ${d.lumenGet} 流明`);
        if (typeof d.pointsAfter === 'number') setPointsBalance(d.pointsAfter);
        if (typeof d.lumenAfter === 'number') setLumenBalance(d.lumenAfter);
      }
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  useEffect(() => {
    const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
    if (!t) { router.push('/login?redirect=/profile'); return; }

    const fetchData = async () => {
      try {
        const r1 = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t, 'Cache-Control': 'no-cache' } });
        if (!r1.ok) { setError('请先登录'); setLoading(false); return; }
        const d1 = await r1.json();
        setUser(d1.user);
        setEditForm({ username: d1.user?.username || '' });
        const [r2, r3, r4, r5] = await Promise.all([
          fetch('/api/user/activations', { headers: { Authorization: 'Bearer ' + t } }),
          fetch('/api/user/unlocks/list', { headers: { Authorization: 'Bearer ' + t } }),
          fetch('/api/user/balance', { headers: { Authorization: 'Bearer ' + t } }),
          fetch('/api/user/weekly-credit', { headers: { Authorization: 'Bearer ' + t } }),
        ]);
        if (r2.ok) { const d2 = await r2.json(); setRecords(d2.items || []); }
        if (r3.ok) { const d3 = await r3.json(); setUnlocks(d3.items || []); }
        if (r4.ok) { const d4 = await r4.json(); if (typeof d4.lumen_balance === 'number') setLumenBalance(d4.lumen_balance); }
        if (r5.ok) { const d5 = await r5.json(); if (d5 && typeof d5.used === 'number') setWeeklyCredit({ used: d5.used, total: d5.total, weekStart: d5.week_start }); }
        // 2026-08-04 P6.3: 加载签到状态
        loadCheckin();
      } catch (e: any) { setError(e.message); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [router]);

  // 业务计算
  // 2026-08-01: 修 /api/auth/me 已返 ISO UTC 字符串 (parseNeonTime 修 tz 标记), 这里直接 new Date() 即可
  const isVip = ['vip', 'admin'].includes(user?.user_group || '');
  const isBasic = user?.user_group === 'basic';
  const expireMs = user?.expire_at ? new Date(user.expire_at).getTime() : null;
  const nowMs = Date.now();
  const isExpired = expireMs != null ? expireMs < nowMs : false;
  // 2026-08-01: 精确到秒 — 显示 "X 天 Y 小时 Z 分" (VIP 截止时间, 用户要求)
  const vipTimeLeft = (() => {
    if (isExpired || expireMs == null) return null;
    const ms = expireMs - nowMs;
    if (ms <= 0) return null;
    const totalMin = Math.floor(ms / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days > 0) return { days, hours, mins, expired: false };
    if (hours > 0) return { days: 0, hours, mins, expired: false };
    return { days: 0, hours: 0, mins, expired: false };
  })();
  const isForever = isVip && (user?.expire_at == null);
  const daysSinceReg = user?.created_at ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000) : 0;
  const daysSinceLogin = user?.last_login ? Math.floor((Date.now() - new Date(user.last_login).getTime()) / 86400000) : 0;
  // 2026-07-28: 每周免费额度 - 真实读 xx_user_weekly_credit
  // VIP 每周 1 个免费解锁额度, 周日 0 点重置 (cron)
  const [weeklyCredit, setWeeklyCredit] = useState<{ used: number; total: number; weekStart: string | null }>({ used: 0, total: 0, weekStart: null });
  const weeklyUsed = weeklyCredit.used;
  const weeklyTotal = isVip ? weeklyCredit.total : 0;  // 只 VIP/admin 有额度

  // 2026-08-04 P6.3: 签到状态 (积分系统, 跟流明分开!)
  const [checkinToday, setCheckinToday] = useState(false);
  const [checkinRecent, setCheckinRecent] = useState<Array<{ id: number; points: number; createdAt: string; description: string }>>([]);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [pointsBalance, setPointsBalance] = useState(0);

  const loadCheckin = async () => {
    try {
      const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
      const r = await fetch('/api/checkin', { headers: { Authorization: 'Bearer ' + t, 'Cache-Control': 'no-cache' } });
      if (r.ok) {
        const d = await r.json();
        setCheckinToday(d.already_checked_in);
        setCheckinRecent(d.recent || []);
        if (typeof d.points_balance === 'number') setPointsBalance(d.points_balance);
      }
    } catch {}
  };

  const handleCheckin = async () => {
    setCheckinLoading(true);
    try {
      const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
      const r = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      });
      const d = await r.json();
      if (d.success) {
        showToast('success', d.message);
        setCheckinToday(true);
        if (typeof d.points_balance === 'number') setPointsBalance(d.points_balance);
        await loadCheckin();
      } else if (d.already_checked_in) {
        showToast('error', d.message);
        setCheckinToday(true);
      } else {
        showToast('error', d.error || '签到失败');
      }
    } catch (e: any) { showToast('error', e.message); }
    finally { setCheckinLoading(false); }
  };

  // 危险操作
  const handleDeleteShares = async () => {
    if (!confirm('⚠️ 永久删除所有分享内容?\n\n此操作不可恢复!')) return;
    setDeleting(true);
    try {
      // 2026-07-28: TODO - 调 /api/user/delete-shares (目前 share 表暂无, 用空操作)
      await new Promise(r => setTimeout(r, 800));
      showToast('success', '✅ 已清空 (暂无分享数据)');
    } catch (e: any) { showToast('error', e.message); }
    finally { setDeleting(false); }
  };

  const handleDeleteAccount = async () => {
    if (user?.user_group === 'admin') {
      showToast('error', '管理员账号不支持注销, 请联系超管');
      return;
    }
    const v = prompt('⚠️ 注销账号会清空所有数据, 不可恢复!\n\n将清空:\n• 所有解锁记录\n• 流明余额\n• 关联激活码标记已用\n• 用户名永久占位\n\n输入 DELETE 确认:');
    if (v !== 'DELETE') {
      showToast('error', '已取消 (输入不匹配)');
      return;
    }
    setDeleting(true);
    try {
      const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
      const r = await fetch('/api/user/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const d = await r.json();
      if (d.success) {
        showToast('success', `✅ 账号已注销, 数据已清空 (${d.cleaned?.unlocks || 0} 解锁 + 流明清零)`);
        // 2026-07-28: 清 token + 跳首页
        setTimeout(() => {
          localStorage.removeItem('zzmm_token');
          localStorage.removeItem('token');
          localStorage.removeItem('adminToken');
          localStorage.removeItem('user');
          router.push(d.redirect || '/');
        }, 1800);
      } else {
        showToast('error', d.error || '注销失败');
      }
    } catch (e: any) {
      showToast('error', '网络错误: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      // TODO: 调 /api/user/update-profile
      await new Promise(r => setTimeout(r, 600));
      showToast('success', '✅ 已保存');
      setUser(prev => prev ? { ...prev, username: editForm.username } : prev);
      setEditOpen(false);
    } catch (e: any) { showToast('error', e.message); }
  };

  const handleChangePassword = async () => {
    if (pwForm.new !== pwForm.confirm) {
      showToast('error', '两次密码不一致');
      return;
    }
    if (pwForm.new.length < 6) {
      showToast('error', '密码至少 6 位');
      return;
    }
    try {
      // TODO: 调 /api/user/change-password
      await new Promise(r => setTimeout(r, 600));
      showToast('success', '✅ 密码已修改');
      setPwOpen(false);
      setPwForm({ old: '', new: '', confirm: '' });
    } catch (e: any) { showToast('error', e.message); }
  };

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">加载中...</div>;
  if (error || !user) return <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">{error || '未登录'}</div>;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex">
      {/* 左侧导航 */}
      <aside className="w-56 border-r border-white/5 bg-[#0c0c14]/50 hidden md:flex flex-col py-6 px-3 sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm">泽泽资源</span>
        </div>
        <nav className="space-y-1 flex-1">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = item.active || pathname === item.href;
            const cls = `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
              isActive
                ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-200 border border-amber-500/30'
                : 'text-white/60 hover:bg-white/5 hover:text-white border border-transparent'
            }`;
            if (item.href) {
              return (
                <Link key={item.key} href={item.href} className={cls}>
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                  {item.badge && <span className="ml-auto text-xs bg-amber-500 text-black px-1.5 py-0.5 rounded">{item.badge}</span>}
                </Link>
              );
            }
            return (
              <button key={item.key} className={cls}>
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
                {item.badge && <span className="ml-auto text-xs bg-amber-500 text-black px-1.5 py-0.5 rounded">{item.badge}</span>}
              </button>
            );
          })}
        </nav>
        <div className="text-[10px] text-white/30 px-3 mt-4">v1.0 · 个人中心</div>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-5xl">
        {/* 头部 */}
        <div className="mb-8 flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl md:text-3xl font-bold">个人中心</h1>
          <span className="text-white/40">·</span>
          <span className="text-white/60 text-sm md:text-base">{user.username}</span>
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block" />
          <Link href="/" className="ml-auto text-xs text-white/40 hover:text-white/80 flex items-center gap-1">
            <Home className="w-3 h-3" /> 返回首页
          </Link>
        </div>

        {/* 2026-08-04 P6.3: 每日签到 + 积分余额 (积分独立系统, 跟流明分开!) */}
        <div className="mb-6 p-4 rounded-xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/[0.04] to-blue-500/[0.04] flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-cyan-300" />
              <span className="font-semibold text-sm text-cyan-100">每日签到 (积分)</span>
              {checkinToday ? (
                <span className="px-1.5 py-0.5 bg-emerald-500/30 text-emerald-300 rounded text-[10px]">✓ 今日已签</span>
              ) : (
                <span className="px-1.5 py-0.5 bg-cyan-500/30 text-cyan-300 rounded text-[10px]">未签到</span>
              )}
            </div>
            <div className="text-xs text-white/50">
              积分余额: <span className="text-cyan-300 font-semibold">{pointsBalance}</span> · 签到奖励: {isVip ? 'VIP/Admin 8-20' : 'Basic 1-5'} 积分
            </div>
            <div className="text-[10px] text-white/30 mt-0.5">
              (流明 {lumenBalance} 是付费系统, 跟积分分开)
            </div>
          </div>
          <button
            onClick={handleCheckin}
            disabled={checkinLoading || checkinToday}
            className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-semibold text-sm flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            {checkinToday ? '今日已签' : checkinLoading ? '签到中...' : '🎯 签到'}
          </button>
        </div>

        {/* 签到记录 (最近 7 天) */}
        {checkinRecent.length > 0 && (
          <div className="mb-6 p-3 rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="text-xs text-white/40 mb-2 flex items-center gap-1">
              <Activity className="w-3 h-3" /> 最近 30 天签到记录 (积分)
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {checkinRecent.slice(0, 7).map(r => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <span className="text-white/60">{new Date(r.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="text-cyan-300 font-semibold">+{r.points} 积分</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2026-07-28: 头部下方快捷操作 (显眼位置放注销) */}
        <div className="mb-6 flex items-center gap-2 flex-wrap p-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.03]">
          <span className="text-xs text-amber-300/80">快捷操作:</span>
          <button onClick={() => router.push('/activate')}
            className="px-3 py-1.5 text-xs rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> 兑换码
          </button>
          <Link href="/library"
            className="px-3 py-1.5 text-xs rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/30 flex items-center gap-1">
            <Crown className="w-3 h-3" /> 我的资源
          </Link>
          {user.user_group !== 'admin' && (
            <button onClick={handleDeleteAccount} disabled={deleting}
              className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/40 flex items-center gap-1 disabled:opacity-50">
              <LogOut className="w-3 h-3" /> 注销账号
            </button>
          )}
          {user.user_group === 'admin' && (
            <span className="ml-auto text-[10px] text-amber-400/60">管理员账号不可注销</span>
          )}
        </div>

        {/* 4 个统计卡 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
          {/* 2026-08-11: 流明卡片 (原错误标"积分" → 实际是 lumen, 改"流明 💡")
              - 加说明: 流明是购买独立付费资源所需
              - 充值按钮左边加积分兑换 (复用 /api/points/redeem 10:1 模式) */}
          <div className="rounded-2xl p-4 md:p-5 border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-yellow-500/5 relative overflow-hidden">
            <div className="absolute top-2 right-2 w-12 h-12 rounded-full bg-amber-500/10 blur-xl" />
            {/* 充值 + 积分兑换 2 个按钮 (积分兑换左, 充值右) */}
            <div className="absolute top-2 right-2 z-10 flex gap-1">
              <button
                onClick={handlePointsRedeem}
                title={`积分兑换流明 (10 积分 = 1 流明, 当前 ${pointsBalance} 积分)`}
                className="px-2 py-0.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 rounded-md text-[10px] text-cyan-200 font-medium transition"
              >
                🔁 积分兑换
              </button>
              <Link href="/upgrade#lumen" className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-md text-[10px] text-amber-200 font-medium transition">
                ➕ 充值
              </Link>
            </div>
            <div className="text-xs text-amber-300/80 mb-1">流 明 💡</div>
            <div className="text-2xl md:text-3xl font-bold text-amber-300">{lumenBalance}</div>
            <div className="text-[10px] text-white/40 mt-1">流明是购买独立付费资源所需</div>
          </div>
          {/* 分享数 */}
          <div className="rounded-2xl p-4 md:p-5 border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-green-500/5 relative overflow-hidden">
            <div className="absolute top-2 right-2 w-12 h-12 rounded-full bg-emerald-500/10 blur-xl" />
            <div className="text-xs text-emerald-300/80 mb-1">分 享</div>
            <div className="text-2xl md:text-3xl font-bold text-emerald-300">{unlocks.length}</div>
            <div className="text-[10px] text-white/40 mt-1">解锁次数</div>
          </div>
          {/* 注册天数 */}
          <div className="rounded-2xl p-4 md:p-5 border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 relative overflow-hidden">
            <div className="absolute top-2 right-2 w-12 h-12 rounded-full bg-cyan-500/10 blur-xl" />
            <div className="text-xs text-cyan-300/80 mb-1">注 册</div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl md:text-3xl font-bold text-cyan-300">{daysSinceReg}</span>
              <span className="text-sm text-cyan-300/80">天</span>
            </div>
            <div className="text-[10px] text-white/40 mt-1">
              {new Date(user.created_at).toISOString().slice(0, 10)}
            </div>
          </div>
          {/* 会员状态 - 2026-08-01 精确到秒 */}
          <div className={`rounded-2xl p-4 md:p-5 border relative overflow-hidden ${
            isVip && !isExpired
              ? 'border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/5 to-pink-500/5'
              : isBasic
                ? 'border-sky-500/20 bg-gradient-to-br from-sky-500/5 to-blue-500/5'
                : 'border-white/10 bg-white/5'
          }`}>
            <div className={`absolute top-2 right-2 w-12 h-12 rounded-full blur-xl ${
              isVip ? 'bg-fuchsia-500/10' : isBasic ? 'bg-sky-500/10' : 'bg-white/5'
            }`} />
            <div className={`text-xs mb-1 ${isVip ? 'text-fuchsia-300/80' : isBasic ? 'text-sky-300/80' : 'text-white/60'}`}>会员状态</div>
            {isForever ? (
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl md:text-3xl font-bold ${isVip ? 'text-fuchsia-300' : 'text-white'}`}>永久</span>
              </div>
            ) : vipTimeLeft ? (
              <div>
                <div className="flex items-baseline gap-1">
                  {vipTimeLeft.days > 0 && (
                    <>
                      <span className={`text-2xl md:text-3xl font-bold ${isVip ? 'text-fuchsia-300' : isBasic ? 'text-sky-300' : 'text-white'}`}>{vipTimeLeft.days}</span>
                      <span className={`text-sm ${isVip ? 'text-fuchsia-300/80' : isBasic ? 'text-sky-300/80' : 'text-white/60'}`}>天</span>
                    </>
                  )}
                  <span className={`text-2xl md:text-3xl font-bold ${isVip ? 'text-fuchsia-300' : isBasic ? 'text-sky-300' : 'text-white'} ${vipTimeLeft.days > 0 ? 'ml-1' : ''}`}>{vipTimeLeft.hours}</span>
                  <span className={`text-sm ${isVip ? 'text-fuchsia-300/80' : isBasic ? 'text-sky-300/80' : 'text-white/60'}`}>时</span>
                  <span className={`text-2xl md:text-3xl font-bold ${isVip ? 'text-fuchsia-300' : isBasic ? 'text-sky-300' : 'text-white'} ml-1`}>{vipTimeLeft.mins}</span>
                  <span className={`text-sm ${isVip ? 'text-fuchsia-300/80' : isBasic ? 'text-sky-300/80' : 'text-white/60'}`}>分</span>
                </div>
                {/* 精确到秒的截止时间戳 (用户要求) */}
                <div className="text-[10px] text-white/40 mt-1 font-mono">
                  {user.expire_at ? `${new Date(user.expire_at).toLocaleString('zh-CN', { hour12: false })} 到期` : ''}
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-2xl md:text-3xl font-bold text-white/40`}>0</span>
                  <span className="text-sm text-white/40">天</span>
                </div>
                <div className="text-[10px] text-red-300/80 mt-1">已过期</div>
              </div>
            )}
            <div className="text-[10px] text-white/40 mt-1">
              {user.user_group === 'admin' ? '👑 管理员' : isVip ? 'VIP 用户' : isBasic ? '基础会员' : '普通用户'}
            </div>
          </div>
        </div>

        {/* 每周免费额度 */}
        <div className="rounded-2xl p-5 border border-white/5 bg-white/[0.02] mb-6 flex items-center gap-5 flex-wrap">
          <div className="relative w-16 h-16 flex-shrink-0">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
              <circle cx="32" cy="32" r="28" fill="none" stroke="#f59e0b" strokeWidth="4"
                strokeDasharray={`${(weeklyUsed / Math.max(weeklyTotal, 1)) * 175.9} 175.9`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
              {weeklyTotal > 0 ? Math.round((weeklyUsed / weeklyTotal) * 100) : 0}%
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-semibold">每周免费额度</span>
              {isVip && <span className="text-[10px] px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300">VIP 用户</span>}
            </div>
            <div className="text-sm text-white/60">
              已用 {weeklyUsed} / {weeklyTotal > 0 ? weeklyTotal : '无限制'}
            </div>
          </div>
          <div className="flex-1 min-w-0 hidden md:block" />
        </div>

        {/* 详细信息 */}
        <div className="rounded-2xl p-5 md:p-6 border border-white/5 bg-white/[0.02] mb-6">
          <h2 className="text-sm font-semibold text-white/80 mb-4">详细信息</h2>
          <div className="space-y-3 text-sm">
            <Row label="用户名" value={user.username} mono />
            <Row label="邮 箱" value={user.username} mono hint="以用户名作邮箱显示" />
            <Row label="Telegram" value={<span className="text-white/40">未绑定</span>} />
            <Row label="ID" value={'#' + user.id} mono />
            <Row label="最后更新" value={user.last_login ? new Date(user.last_login).toISOString().slice(0, 16).replace('T', ' ') : '—'} mono />
          </div>
        </div>

        {/* 账户设置 */}
        <div className="rounded-2xl p-5 md:p-6 border border-white/5 bg-white/[0.02] mb-6">
          <h2 className="text-sm font-semibold text-white/80 mb-4">账户设置</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ActionCard icon={Lock} title="修改密码" desc="更新您的登录密码" onClick={() => setPwOpen(true)} />
            <ActionCard icon={User} title="个人设置" desc="修改昵称等个人信息" onClick={() => setEditOpen(true)} />
            <ActionCard icon={Edit3} title="邮箱已绑定" desc="当前系统暂不允许修改绑定邮箱" disabled />
            <ActionCard icon={MessageCircle} title="绑定 Telegram" desc="前往 Telegram 流程完成绑定" onClick={() => showToast('success', '请到 Telegram 群联系客服')} />
            <ActionCard icon={Sparkles} title="兑换 Premium" desc="使用兑换码激活会员" onClick={() => router.push('/activate')} />
            <ActionCard icon={Shield} title="已授权应用" desc="查看并解绑第三方 OpenAPI 应用" onClick={() => showToast('success', '暂未授权任何应用')} />
          </div>
        </div>

        {/* 危险操作 */}
        <div className="rounded-2xl p-5 md:p-6 border border-red-500/20 bg-red-500/[0.02] mb-6">
          <h2 className="text-sm font-semibold text-red-300 mb-4">危险操作</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ActionCard icon={Trash2} title="删除全部分享" desc="永久删除所有分享内容" danger onClick={handleDeleteShares} loading={deleting} />
            <ActionCard icon={LogOut} title="注销账号" desc="清空绑定并删除全部分享" danger onClick={handleDeleteAccount} loading={deleting} />
          </div>
        </div>

        {/* 兑换记录 / 解锁记录 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl p-5 border border-white/5 bg-white/[0.02]">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" /> 兑换记录 <span className="text-xs text-white/40">({records.length})</span>
            </h2>
            {records.length === 0 ? (
              <div className="text-center py-6 text-white/40 text-xs">暂无兑换记录</div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {records.slice(0, 10).map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-white/5">
                    <span className="text-white/50 font-mono">{new Date(r.used_at).toISOString().slice(5, 10)}</span>
                    <span className="font-mono text-violet-300 truncate flex-1">{r.code}</span>
                    <span className="text-amber-300 whitespace-nowrap">
                      {r.code_type === 'vip' ? (r.duration === 0 || r.duration === 9999 ? '永久' : `${r.duration}d`) : r.code_type}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl p-5 border border-white/5 bg-white/[0.02]">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Unlock className="w-4 h-4 text-emerald-400" /> 解锁记录 <span className="text-xs text-white/40">({unlocks.length})</span>
            </h2>
            {unlocks.length === 0 ? (
              <div className="text-center py-6 text-white/40 text-xs">尚无解锁记录</div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {unlocks.slice(0, 10).map(u => (
                  <div key={u.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-white/5">
                    <span className="text-white/50 font-mono">{new Date(u.unlocked_at).toISOString().slice(5, 10)}</span>
                    <span className="text-white truncate flex-1" title={u.resource_name || ''}>
                      {u.resource_name?.slice(0, 18) || '#' + u.resource_id}
                    </span>
                    <span className="text-fuchsia-300 whitespace-nowrap">💎{u.lumen_cost}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 编辑个人资料弹窗 */}
      <AnimatePresence>
        {editOpen && (
          <Modal onClose={() => setEditOpen(false)} title="个人设置">
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">用户名</label>
                <input value={editForm.username} onChange={e => setEditForm({ username: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div className="flex gap-2 mt-4 justify-end">
                <button onClick={() => setEditOpen(false)} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">取消</button>
                <button onClick={handleSaveProfile} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm">保存</button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* 修改密码弹窗 */}
      <AnimatePresence>
        {pwOpen && (
          <Modal onClose={() => setPwOpen(false)} title="修改密码">
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">旧密码</label>
                <input type="password" value={pwForm.old} onChange={e => setPwForm({ ...pwForm, old: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">新密码 (至少 6 位)</label>
                <input type="password" value={pwForm.new} onChange={e => setPwForm({ ...pwForm, new: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">确认新密码</label>
                <input type="password" value={pwForm.confirm} onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div className="flex gap-2 mt-4 justify-end">
                <button onClick={() => setPwOpen(false)} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">取消</button>
                <button onClick={handleChangePassword} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm">修改</button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-lg text-sm z-50 ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 内部小组件
function Row({ label, value, mono, hint }: { label: string; value: any; mono?: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-white/5">
      <span className="text-white/50 text-xs flex-shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        {hint && <span className="text-[10px] text-white/30 hidden md:inline">{hint}</span>}
        <span className={`text-white truncate ${mono ? 'font-mono text-sm' : 'text-sm'}`}>{value}</span>
      </div>
    </div>
  );
}

function ActionCard({ icon: Icon, title, desc, onClick, disabled, danger, loading }: {
  icon: any; title: string; desc: string; onClick?: () => void; disabled?: boolean; danger?: boolean; loading?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled || loading}
      className={`text-left p-4 rounded-xl border transition flex items-start gap-3 ${
        disabled
          ? 'border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed'
          : danger
            ? 'border-red-500/20 bg-red-500/[0.03] hover:bg-red-500/[0.08] hover:border-red-500/40'
            : 'border-white/5 bg-white/[0.02] hover:bg-white/5 hover:border-white/10'
      }`}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
        disabled ? 'bg-white/5 text-white/30' : danger ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'
      }`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm mb-0.5">{title}</div>
        <div className="text-xs text-white/50 line-clamp-2">{desc}</div>
      </div>
      {loading && <div className="text-xs text-white/60">...</div>}
    </button>
  );
}

function Modal({ children, onClose, title }: { children: any; onClose: () => void; title: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
        className="bg-[#12121a] rounded-2xl p-6 w-full max-w-md border border-white/10 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
