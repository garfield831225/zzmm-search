'use client';

// 2026-10-15: basic 用户月度福利 banner
//   - basic 用户每月可领 1 天 vip 体验
//   - 已领过会显示"本月已领, 下月再来"
//   - 用于首页 header 内 + /profile 顶部, 提升入口可见度
import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';

interface ClaimStatus {
  eligible: boolean;
  reason?: string;
  user_group?: string;
  period_key?: string;
  claimed_this_month?: boolean;
  vip_expire_at?: string | null;
}

export default function BasicClaimBanner({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<ClaimStatus | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [userGroup, setUserGroup] = useState<string>('');

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) return;
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      setUserGroup(String(u.group || '').toLowerCase());
    } catch {}
    fetch('/api/basic-vip-claim', { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(() => setStatus(null));
  }, []);

  // 不显示: 未登录 + 不是 basic
  if (userGroup !== 'basic') return null;
  if (!status) return null;

  const claim = async () => {
    setClaiming(true);
    try {
      const t = localStorage.getItem('token') || '';
      const r = await fetch('/api/basic-vip-claim', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      });
      const d = await r.json();
      if (r.ok) {
        setStatus({
          eligible: false,
          claimed_this_month: true,
          period_key: status?.period_key,
          vip_expire_at: d.vip_expire_at,
        });
        alert('🎉 1 天 vip 体验已激活! 24h 后自动降级 basic');
      } else {
        alert(d.error || '领取失败');
      }
    } catch (e: any) {
      alert('领取失败: ' + (e.message || '未知错误'));
    } finally {
      setClaiming(false);
    }
  };

  // compact 模式: 简化宽度, 适合 header 内 (避免占太多横向空间)
  if (compact) {
    if (status.claimed_this_month) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-pink-500/15 to-violet-500/15 border border-pink-500/25 rounded-lg text-xs text-white/80">
          <Gift className="w-4 h-4 text-pink-300 shrink-0" />
          <span className="hidden sm:inline">本月已领 · 到期 {status.vip_expire_at ? new Date(status.vip_expire_at).toLocaleDateString('zh-CN') : '—'}</span>
          <span className="sm:hidden">本月已领</span>
        </div>
      );
    }
    return (
      <button
        onClick={claim}
        disabled={claiming}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90 disabled:opacity-50 rounded-lg text-xs font-medium transition whitespace-nowrap"
      >
        <Gift className="w-4 h-4" />
        <span className="hidden sm:inline">{claiming ? '领取中...' : '领取 1 天 vip'}</span>
        <span className="sm:hidden">{claiming ? '领取中' : '1 天 vip'}</span>
      </button>
    );
  }

  // 完整模式 (profile 用): 跟 /upgrade 那块一样的样式
  return (
    <div className="mb-6 p-4 bg-gradient-to-r from-pink-500/20 to-violet-500/20 border border-pink-500/30 rounded-xl text-white/90 text-sm flex items-center gap-3">
      <Gift className="w-6 h-6 flex-shrink-0 text-pink-300" />
      {status.claimed_this_month ? (
        <div className="flex-1">
          <div className="font-medium text-pink-200">本月 1 天 vip 体验已领取</div>
          <div className="text-xs text-white/60 mt-0.5">
            vip 到期: {status.vip_expire_at ? new Date(status.vip_expire_at).toLocaleString('zh-CN') : '—'} · 下月 1 号再来
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1">
            <div className="font-medium">🎁 领取本月 1 天 vip 体验</div>
            <div className="text-xs text-white/60 mt-0.5">basic 月度福利 · 24h 自动降级</div>
          </div>
          <button
            onClick={claim}
            disabled={claiming}
            className="px-4 py-1.5 bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90 disabled:opacity-50 rounded-lg text-sm font-medium transition"
          >
            {claiming ? '领取中...' : '立即领取'}
          </button>
        </>
      )}
    </div>
  );
}
