'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ShieldAlert, MapPin, Clock, User, Ban, CheckCircle2, RefreshCw, ArrowLeft, AlertTriangle, Globe } from 'lucide-react';

// 2026-07-29: 登录 IP 风险监测 (用户拍板)
// - 顶部: 今日统计 (总登录次数 / 风险用户数)
// - 风险用户: 当天 ≥2 个城市的用户 (admin 可禁用/解禁)
// - 最近登录: 全站最近 50 个用户 (IP + 城市)
interface RiskyUser {
  id: number;
  username: string;
  user_group: string;
  status: string;
  last_login_ip: string | null;
  last_login_city: string | null;
  cities: string[] | null;
  ips: string[] | null;
  login_count: string;
  last_login: string;
}
interface RecentLogin {
  id: number;
  username: string;
  user_group: string;
  status: string;
  last_login: string | null;
  last_login_ip: string | null;
  last_login_city: string | null;
}

export default function LoginRiskPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    today: string;
    total_logins_today: number;
    risky_users: RiskyUser[];
    recent_logins: RecentLogin[];
  } | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);

  // 鉴权
  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) {
      setAuthed(false);
      return;
    }
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u.group === 'admin') {
        setAuthed(true);
      } else {
        setAuthed(false);
      }
    } catch { setAuthed(false); }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/admin/login-risk', {
        credentials: 'include',
        headers: { Authorization: 'Bearer ' + (token || '') },
        cache: 'no-store',
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setToast({ type: 'err', msg: d.error || `HTTP ${r.status}` });
        return;
      }
      const d = await r.json();
      setData(d);
    } catch (e: any) {
      setToast({ type: 'err', msg: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) fetchData();
  }, [authed, fetchData]);

  const handleAction = async (userId: number, action: 'ban' | 'unban') => {
    if (!confirm(action === 'ban' ? '⚠️ 确认禁用此账号？该用户将立即被踢出' : '确认解禁此账号？')) return;
    setActionId(userId);
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/admin/login-risk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') },
        body: JSON.stringify({ user_id: userId, action }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setToast({ type: 'err', msg: d.error || `HTTP ${r.status}` });
        return;
      }
      setToast({ type: 'ok', msg: action === 'ban' ? '✅ 已禁用' : '✅ 已解禁' });
      await fetchData();
    } catch (e: any) {
      setToast({ type: 'err', msg: e.message });
    } finally {
      setActionId(null);
      setTimeout(() => setToast(null), 3000);
    }
  };

  if (authed === null) {
    return <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">加载中...</div>;
  }
  if (authed === false) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl mb-4">🔒</div>
          <p className="mb-4 text-white/60">需要 admin 权限</p>
          <Link href="/login" className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm">去登录</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> 后台
            </Link>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              登录 IP 风险监测
            </h1>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm inline-flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* 统计卡 */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <div className="bg-[#12121a] border border-white/5 rounded-xl p-4">
              <div className="text-xs text-white/40 mb-1">今日 (CST) 日期</div>
              <div className="text-2xl font-bold text-cyan-300">{data.today}</div>
            </div>
            <div className="bg-[#12121a] border border-white/5 rounded-xl p-4">
              <div className="text-xs text-white/40 mb-1">今日总登录次数</div>
              <div className="text-2xl font-bold text-violet-300">{data.total_logins_today}</div>
            </div>
            <div className={`bg-[#12121a] border rounded-xl p-4 ${data.risky_users.length > 0 ? 'border-amber-500/30' : 'border-white/5'}`}>
              <div className="text-xs text-white/40 mb-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> 风险用户 (≥2 城市)
              </div>
              <div className={`text-2xl font-bold ${data.risky_users.length > 0 ? 'text-amber-300' : 'text-white/40'}`}>
                {data.risky_users.length}
              </div>
            </div>
          </div>
        )}

        {/* 风险用户 */}
        {data && data.risky_users.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-amber-300">
              <AlertTriangle className="w-4 h-4" />
              当日高风险用户 ({data.risky_users.length})
            </h2>
            <div className="bg-[#12121a] border border-amber-500/20 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-amber-500/5 text-amber-200 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2">用户</th>
                      <th className="text-left px-3 py-2">分组</th>
                      <th className="text-left px-3 py-2">登录次数</th>
                      <th className="text-left px-3 py-2">城市 (今日)</th>
                      <th className="text-left px-3 py-2">IP 列表</th>
                      <th className="text-left px-3 py-2">最近登录</th>
                      <th className="text-left px-3 py-2">状态</th>
                      <th className="text-right px-3 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.risky_users.map((u) => (
                      <tr key={u.id} className="border-t border-white/5 hover:bg-white/5">
                        <td className="px-3 py-2">
                          <div className="font-medium">{u.username}</div>
                          <div className="text-[10px] text-white/40">id={u.id}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${u.user_group === 'vip' ? 'bg-amber-500/20 text-amber-300' : u.user_group === 'admin' ? 'bg-violet-500/20 text-violet-300' : 'bg-white/5 text-white/60'}`}>
                            {u.user_group}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-cyan-300 font-mono">{u.login_count}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(u.cities || []).map((c) => (
                              <span key={c} className="px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-200 rounded inline-flex items-center gap-0.5">
                                <MapPin className="w-2.5 h-2.5" /> {c}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-white/50 max-w-[180px]">
                          {(u.ips || []).map((ip) => <div key={ip}>{ip}</div>)}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-white/50">
                          {u.last_login ? new Date(u.last_login).toLocaleString('zh-CN', { hour12: false }) : '-'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${u.status === 'banned' ? 'bg-red-500/20 text-red-300' : u.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-white/60'}`}>
                            {u.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {u.user_group === 'admin' ? (
                            <span className="text-[10px] text-white/30">-</span>
                          ) : u.status === 'banned' ? (
                            <button
                              onClick={() => handleAction(u.id, 'unban')}
                              disabled={actionId === u.id}
                              className="px-2 py-1 text-[10px] bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 rounded inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" /> 解禁
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAction(u.id, 'ban')}
                              disabled={actionId === u.id}
                              className="px-2 py-1 text-[10px] bg-red-600/30 hover:bg-red-600/50 text-red-200 rounded inline-flex items-center gap-1"
                            >
                              <Ban className="w-3 h-3" /> 禁用
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 最近登录 */}
        {data && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-white/80">
              <User className="w-4 h-4" />
              最近登录用户 (前 50)
            </h2>
            <div className="bg-[#12121a] border border-white/5 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-white/50 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2">用户</th>
                      <th className="text-left px-3 py-2">分组</th>
                      <th className="text-left px-3 py-2">最近登录 IP</th>
                      <th className="text-left px-3 py-2">城市</th>
                      <th className="text-left px-3 py-2">登录时间</th>
                      <th className="text-left px-3 py-2">状态</th>
                      <th className="text-right px-3 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_logins.map((u) => (
                      <tr key={u.id} className="border-t border-white/5 hover:bg-white/5">
                        <td className="px-3 py-2">
                          <div className="font-medium">{u.username}</div>
                          <div className="text-[10px] text-white/40">id={u.id}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${u.user_group === 'vip' ? 'bg-amber-500/20 text-amber-300' : u.user_group === 'admin' ? 'bg-violet-500/20 text-violet-300' : 'bg-white/5 text-white/60'}`}>
                            {u.user_group}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-white/70">
                          {u.last_login_ip || '-'}
                        </td>
                        <td className="px-3 py-2 text-xs text-white/70">
                          {u.last_login_city || <span className="text-white/30">未识别</span>}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-white/50">
                          {u.last_login ? new Date(u.last_login).toLocaleString('zh-CN', { hour12: false }) : '-'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${u.status === 'banned' ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                            {u.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {u.user_group === 'admin' ? (
                            <span className="text-[10px] text-white/30">-</span>
                          ) : u.status === 'banned' ? (
                            <button
                              onClick={() => handleAction(u.id, 'unban')}
                              disabled={actionId === u.id}
                              className="px-2 py-1 text-[10px] bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 rounded"
                            >解禁</button>
                          ) : (
                            <button
                              onClick={() => handleAction(u.id, 'ban')}
                              disabled={actionId === u.id}
                              className="px-2 py-1 text-[10px] bg-red-600/30 hover:bg-red-600/50 text-red-200 rounded"
                            >禁用</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {data && data.recent_logins.length === 0 && (
          <div className="text-center text-white/40 py-12">暂无登录记录</div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg text-sm shadow-lg z-50 ${
            toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.msg}
        </motion.div>
      )}
    </div>
  );
}
