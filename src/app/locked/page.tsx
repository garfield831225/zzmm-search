// /locked - 用户账号被锁定页面 (2026-10-20 异常用户登录设计)
//   middleware 在用户 locked_until > NOW() 时 302 到这里
//   客户端显示: 锁定原因 + 倒计时 + 解锁后自动跳转
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const REASON_LABEL: Record<string, string> = {
  cross_region: '检测到跨地域登录, 为保护账号安全已临时锁定',
  click_500: '24 小时内点击量超过 500 次, 已限制登录 1 小时',
  click_1000: '24 小时内点击量超过 1000 次, 已限制登录 2 小时',
  banned_click: '1 小时内点击量异常 (≥500), 账号已被永久封禁',
  manual_ban: '管理员手动封禁',
};
const DEFAULT_LABEL = '账号已锁定, 请联系管理员';

function fmt(seconds: number): string {
  if (seconds <= 0) return '即将解锁';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} 小时 ${m} 分 ${s} 秒`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function LockedInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get('reason') || 'manual_ban';
  const secondsParam = Number(params.get('seconds') || '0');
  const banned = reason === 'banned_click' || reason === 'manual_ban';

  const [seconds, setSeconds] = useState<number>(secondsParam);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [seconds]);

  useEffect(() => {
    if (banned) return;
    if (seconds <= 0) {
      // 时间到, 试回原页面 (middleware 会再判断)
      router.replace('/');
    }
  }, [seconds, banned, router]);

  const label = REASON_LABEL[reason] || DEFAULT_LABEL;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-4">
      <div className="max-w-md w-full bg-slate-900/80 border border-amber-700/40 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/20 text-amber-300 text-3xl">
          🔒
        </div>
        <h1 className="text-2xl font-bold text-center mb-2">账号暂被锁定</h1>
        <p className="text-slate-300 text-center mb-6">{label}</p>

        {!banned && seconds > 0 && (
          <div className="text-center mb-6">
            <div className="text-sm text-slate-400 mb-1">剩余解锁时间</div>
            <div className="text-3xl font-mono font-bold text-amber-300">{fmt(seconds)}</div>
          </div>
        )}

        {banned && (
          <div className="text-center mb-6">
            <div className="text-sm text-slate-400 mb-1">状态</div>
            <div className="text-3xl font-bold text-rose-300">永久封禁</div>
          </div>
        )}

        <div className="bg-slate-800/50 rounded-lg p-4 text-sm text-slate-300 space-y-1 mb-6">
          <div>• 如果不是本人操作, 请尽快修改密码</div>
          <div>• 解锁后系统自动跳转, 无需手动刷页</div>
          <div>• 异常账号请联系管理员</div>
        </div>

        <Link
          href="/logout"
          className="block w-full text-center bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-lg transition"
        >
          退出登录
        </Link>
      </div>
    </div>
  );
}

// Next.js 14: useSearchParams 需包 Suspense (避免 build prerender 错)
// 这里 inner 用 useSearchParams, outer 用 Suspense fallback (loading)
export default function LockedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        加载中...
      </div>
    }>
      <LockedInner />
    </Suspense>
  );
}
