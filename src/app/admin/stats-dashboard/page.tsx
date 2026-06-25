'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Database, Users, Lock, Sparkles, Tag, TrendingUp, Coins } from 'lucide-react';

interface DetailedStats {
  ok: boolean;
  generated_at: string;
  totals: {
    total_resources: number;
    unmatched: number;
    matched: number;
    total_users: number;
    vip_users: number;
    total_codes: number;
    used_codes: number;
    total_unlocks: number;
    lumen_in: number;
    lumen_out: number;
  };
  resource_growth_30d: { date: string; cnt: number }[];
  user_growth_30d: { date: string; cnt: number }[];
  category_match: { category: string; total: number; matched: number; unmatched: number }[];
  codes_by_type: { code_type: string; total: number; used: number }[];
  source_dist: { source: string; cnt: number }[];
  lumen_dist: { lumen_cost: number; cnt: number }[];
}

// 简易折线图组件
function MiniLine({ data, height = 80, color = '#a78bfa', label = '' }: { data: { date: string; cnt: number }[]; height?: number; color?: string; label?: string }) {
  if (!data.length) return <div className="text-white/40 text-xs">暂无数据</div>;
  const max = Math.max(...data.map(d => d.cnt), 1);
  const width = 600;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = height - (d.cnt / max) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const total = data.reduce((s, d) => s + d.cnt, 0);
  return (
    <div>
      <div className="flex items-end justify-between mb-1">
        <div className="text-xs text-white/40">{label}</div>
        <div className="text-sm font-bold" style={{ color }}>{total}</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
        {data.map((d, i) => {
          const x = i * stepX;
          const y = height - (d.cnt / max) * (height - 4) - 2;
          return <circle key={i} cx={x} cy={y} r="2.5" fill={color} />;
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-white/30 mt-1">
        <span>{data[0]?.date?.slice(5)}</span>
        <span>{data[data.length - 1]?.date?.slice(5)}</span>
      </div>
    </div>
  );
}

// 横向条形图
function MiniBar({ items, color = '#a78bfa' }: { items: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div className="space-y-2">
      {items.slice(0, 12).map((i, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div className="w-20 truncate text-xs text-white/60">{i.label}</div>
          <div className="flex-1 bg-white/5 rounded h-5 overflow-hidden">
            <div className="h-full rounded" style={{ width: (i.value / max * 100) + '%', background: color }} />
          </div>
          <div className="w-16 text-right text-xs font-mono text-white/80">{i.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

export default function StatsDashboardPage() {
  const [stats, setStats] = useState<DetailedStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const t = typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || '') : '';
    if (t) { setToken(t); setAuthed(true); }
  }, []);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/admin/stats/detailed', { headers: { Authorization: 'Bearer ' + token } });
      const d = await r.json();
      if (d.error) alert(d.error);
      else setStats(d);
    } catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (authed) fetchStats(); }, [authed, fetchStats]);

  // 登录 - 由 /admin/layout.tsx 统一处理
  if (!authed) return null;

  if (!stats) return <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">加载中...</div>;

  const matchRate = stats.totals.total_resources > 0
    ? Math.round(stats.totals.matched / stats.totals.total_resources * 100)
    : 0;
  const codeUsedRate = stats.totals.total_codes > 0
    ? Math.round(stats.totals.used_codes / stats.totals.total_codes * 100)
    : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <TrendingUp className="w-7 h-7 text-violet-400" /> 详细统计大屏
            </h1>
            <p className="text-xs text-white/40 mt-1">数据更新于 {new Date(stats.generated_at).toLocaleString('zh-CN')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchStats} disabled={loading} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm flex items-center gap-1">
              <RefreshCw className={'w-3 h-3 ' + (loading ? 'animate-spin' : '')} /> 刷新
            </button>
            <Link href="/admin" className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> 返回
            </Link>
          </div>
        </div>

        {/* 总览卡片 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 flex items-center gap-1"><Database className="w-3 h-3" /> 总资源</div>
            <div className="text-2xl font-bold mt-1">{stats.totals.total_resources.toLocaleString()}</div>
            <div className="text-xs text-emerald-400 mt-1">{matchRate}% 匹配率</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 flex items-center gap-1"><Sparkles className="w-3 h-3" /> 已匹配</div>
            <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.totals.matched.toLocaleString()}</div>
            <div className="text-xs text-white/40 mt-1">未匹配 {stats.totals.unmatched.toLocaleString()}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 flex items-center gap-1"><Users className="w-3 h-3" /> 用户</div>
            <div className="text-2xl font-bold mt-1 text-sky-400">{stats.totals.total_users}</div>
            <div className="text-xs text-amber-400 mt-1">VIP {stats.totals.vip_users}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 flex items-center gap-1"><Tag className="w-3 h-3" /> 激活码</div>
            <div className="text-2xl font-bold mt-1">{stats.totals.total_codes}</div>
            <div className="text-xs text-violet-400 mt-1">使用率 {codeUsedRate}%</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 flex items-center gap-1"><Lock className="w-3 h-3" /> 解锁</div>
            <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.totals.total_unlocks}</div>
            <div className="text-xs text-white/40 mt-1">单资源解锁</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 flex items-center gap-1"><Coins className="w-3 h-3" /> 流明流水</div>
            <div className="text-lg font-bold mt-1 text-fuchsia-400">↑{stats.totals.lumen_in.toLocaleString()}</div>
            <div className="text-lg font-bold text-orange-400">↓{stats.totals.lumen_out.toLocaleString()}</div>
          </div>
        </div>

        {/* 30 天增长折线 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" /> 30 天资源增长
            </h2>
            <MiniLine data={stats.resource_growth_30d} color="#34d399" label="近 30 天累计新增" />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-sky-400" /> 30 天用户增长
            </h2>
            <MiniLine data={stats.user_growth_30d} color="#38bdf8" label="近 30 天累计新增" />
          </motion.div>
        </div>

        {/* 分类匹配率 + 卡密类型 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
            <h2 className="text-lg font-semibold mb-4">📊 各分类匹配情况</h2>
            <MiniBar items={stats.category_match.map(c => ({ label: c.category, value: c.total }))} color="#a78bfa" />
            <div className="mt-4 text-xs text-white/40">柱长 = 总资源数 · 实际匹配率详见 admin → 匹配管理</div>
          </div>
          <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
            <h2 className="text-lg font-semibold mb-4">🎫 卡密类型分布</h2>
            <MiniBar items={stats.codes_by_type.map(c => ({ label: c.code_type || 'unknown', value: c.total }))} color="#fb923c" />
            <div className="mt-4 text-xs text-white/40">总 {stats.totals.total_codes} / 已用 {stats.totals.used_codes}</div>
          </div>
        </div>

        {/* 来源分布 + lumen_cost */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
            <h2 className="text-lg font-semibold mb-4">📦 来源分布 (Top 10)</h2>
            <MiniBar items={stats.source_dist.map(s => ({ label: s.source || 'unknown', value: s.cnt }))} color="#22d3ee" />
          </div>
          <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
            <h2 className="text-lg font-semibold mb-4">💎 lumen_cost 分布</h2>
            <MiniBar items={stats.lumen_dist.map(l => ({ label: l.lumen_cost + ' 流明', value: l.cnt }))} color="#f472b6" />
            <div className="mt-4 text-xs text-white/40">默认按分类设置: 剧集10 / 电影5 / 动漫5 / 综艺3 / 纪录片5 / 演唱会5 / 音乐2</div>
          </div>
        </div>
      </div>
    </div>
  );
}