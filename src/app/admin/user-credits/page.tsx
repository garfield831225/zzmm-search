'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Coins, Crown, Calendar, User, Search, RefreshCw, ArrowLeft, Activity, Sparkles, TrendingUp } from 'lucide-react';

// 2026-07-29: 用户看板 - admin 看所有用户流明余额 + VIP 状态 + weekly credit + 解锁次数

interface UserRow {
  id: number;
  username: string;
  user_group: string;
  status: string;
  expire_at: string | null;
  last_login: string | null;
  last_login_ip: string | null;
  last_login_city: string | null;
  created_at: string;
  lumen_balance: number;
  weekly_used: number | null;
  weekly_total: number | null;
  week_start: string | null;
  unlock_count: number;
}

export default function UserCreditsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<UserRow[]>([]);
  const [stats, setStats] = useState<{ total_active: number; total_vip: number; total_lumen_balance: number; total_users: number } | null>(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // 鉴权
  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { setAuthed(false); return; }
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u.group === 'admin') setAuthed(true);
      else setAuthed(false);
    } catch { setAuthed(false); }
  }, []);

  const fetchData = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const r = await fetch('/api/admin/user-credits?' + params.toString(), {
        credentials: 'include',
        headers: { Authorization: 'Bearer ' + (token || '') },
        cache: 'no-store',
      });
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.items || []);
      setStats({
        total_active: d.total_active,
        total_vip: d.total_vip,
        total_lumen_balance: d.total_lumen_balance,
        total_users: d.total_users,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (authed) fetchData(search); }, [authed, search, fetchData]);

  if (authed === null) return <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">加载中...</div>;
  if (authed === false) return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-5xl mb-4">🔒</div>
        <p className="mb-4 text-white/60">需要 admin 权限</p>
        <Link href="/login" className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm">去登录</Link>
      </div>
    </div>
  );

  // VIP 状态计算
  const isVipActive = (u: UserRow) => {
    if (u.user_group === 'admin') return true;
    if (u.user_group !== 'vip') return false;
    if (!u.expire_at) return true;  // 永久
    return new Date(u.expire_at).getTime() > Date.now();
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> 后台
            </Link>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              用户看板 (流明 + VIP 状态)
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(search)}
              disabled={loading}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm inline-flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>

        {/* 统计卡 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-[#12121a] border border-white/5 rounded-xl p-4">
              <div className="text-xs text-white/40 mb-1 flex items-center gap-1"><User className="w-3 h-3" /> 活跃用户</div>
              <div className="text-2xl font-bold text-emerald-300">{stats.total_active}</div>
            </div>
            <div className="bg-[#12121a] border border-white/5 rounded-xl p-4">
              <div className="text-xs text-white/40 mb-1 flex items-center gap-1"><Crown className="w-3 h-3" /> VIP + Admin</div>
              <div className="text-2xl font-bold text-amber-300">{stats.total_vip}</div>
            </div>
            <div className="bg-[#12121a] border border-white/5 rounded-xl p-4">
              <div className="text-xs text-white/40 mb-1 flex items-center gap-1"><Coins className="w-3 h-3" /> 全站流明</div>
              <div className="text-2xl font-bold text-amber-300">{stats.total_lumen_balance.toLocaleString()}</div>
            </div>
            <div className="bg-[#12121a] border border-white/5 rounded-xl p-4">
              <div className="text-xs text-white/40 mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> 总用户数</div>
              <div className="text-2xl font-bold text-cyan-300">{stats.total_users}</div>
            </div>
          </div>
        )}

        {/* 搜索 */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchInput); }}
              placeholder="搜索用户名或 ID..."
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 w-4 h-4" />
          </div>
          <button
            onClick={() => setSearch(searchInput)}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm"
          >搜索</button>
          {search && (
            <button onClick={() => { setSearchInput(''); setSearch(''); }} className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm">清除</button>
          )}
        </div>

        {/* 表格 */}
        <div className="bg-[#12121a] border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/50 text-xs">
                <tr>
                  <th className="text-left px-3 py-2.5">用户</th>
                  <th className="text-left px-3 py-2.5">分组</th>
                  <th className="text-left px-3 py-2.5">状态</th>
                  <th className="text-left px-3 py-2.5">流明</th>
                  <th className="text-left px-3 py-2.5">VIP 到期</th>
                  <th className="text-left px-3 py-2.5">每周额度</th>
                  <th className="text-left px-3 py-2.5">解锁次数</th>
                  <th className="text-left px-3 py-2.5">登录 IP / 城市</th>
                  <th className="text-left px-3 py-2.5">最近登录</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => {
                  const vip = isVipActive(u);
                  return (
                    <tr key={u.id} className="border-t border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.username}</div>
                        <div className="text-[10px] text-white/40">id={u.id}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                          u.user_group === 'admin' ? 'bg-violet-500/20 text-violet-300' :
                          u.user_group === 'vip' ? 'bg-amber-500/20 text-amber-300' :
                          u.user_group === 'basic' ? 'bg-cyan-500/20 text-cyan-300' :
                          'bg-white/5 text-white/60'
                        }`}>
                          {u.user_group}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                          u.status === 'banned' ? 'bg-red-500/20 text-red-300' :
                          u.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' :
                          'bg-white/5 text-white/60'
                        }`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Coins className="w-3 h-3 text-amber-300" />
                          <span className={`font-mono font-medium ${u.lumen_balance > 0 ? 'text-amber-300' : 'text-white/30'}`}>
                            {u.lumen_balance}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {u.user_group === 'vip' || u.user_group === 'admin' ? (
                          vip ? (
                            <div className="text-xs">
                              <div className="text-emerald-300">✅ 有效</div>
                              {u.expire_at && (
                                <div className="text-[10px] text-white/40">
                                  {new Date(u.expire_at).toLocaleDateString('zh-CN')}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs">
                              <div className="text-red-300">❌ 已过期</div>
                              {u.expire_at && (
                                <div className="text-[10px] text-white/40">
                                  {new Date(u.expire_at).toLocaleDateString('zh-CN')}
                                </div>
                              )}
                            </div>
                          )
                        ) : (
                          <span className="text-white/30 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {u.weekly_total !== null ? (
                          <div>
                            <div className="font-mono text-cyan-300">
                              {u.weekly_used || 0} / {u.weekly_total}
                            </div>
                            {u.week_start && (
                              <div className="text-[10px] text-white/40">
                                周 {new Date(u.week_start).toLocaleDateString('zh-CN')}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="font-mono text-cyan-300">{u.unlock_count}</span>
                      </td>
                      <td className="px-3 py-2 text-[10px] text-white/50 max-w-[180px]">
                        <div className="font-mono">{u.last_login_ip || '-'}</div>
                        <div className="text-white/30">{u.last_login_city || '未识别'}</div>
                      </td>
                      <td className="px-3 py-2 text-[10px] text-white/50">
                        {u.last_login ? new Date(u.last_login).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && !loading && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-white/40">无数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
