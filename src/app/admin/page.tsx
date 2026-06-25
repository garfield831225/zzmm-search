'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

type Tab = 'stats' | 'users' | 'codes' | 'import' | 'match';

interface DashboardData {
  total_codes: number;
  used_codes: number;
  unused_codes: number;
  total_revenue: number;
  total_users: number;
  vip_count: number;
  vip_active: number;
  month_generated: number;
  month_used: number;
  month_revenue: number;
  channel_stats: Array<{ channel: string; code_type: string; total: number; used: number }>;
  trend: Array<{ day: string; generated: number; used: number }>;
  expiring_soon: Array<{ id: number; username: string; expire_at: string }>;
  expired: Array<{ id: number; username: string; expire_at: string }>;
}

export default function AdminPage() {
   const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<any>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);
  const [taskStatus, setTaskStatus] = useState<any>(null);
  const [taskPolling, setTaskPolling] = useState(false);

  useEffect(() => {
    // 优先读 cookie（登录成功后后端设置的 zzmm_token）
    const cookieToken = document.cookie.split('; ').find(r => r.startsWith('zzmm_token='))?.split('=')[1];
    // fallback：旧 localStorage adminToken（兼容旧会话）
    const saved = localStorage.getItem('adminToken');
    if (cookieToken || saved) {
      setToken(cookieToken || saved || '');
      setAuthed(true);
    }
  }, []);

  const fetchStats = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/stats?key=' + token);
      const data = await res.json();
      setStats(data);
    } catch {} finally { setLoading(false); }
  };

  const fetchDashboard = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/stats/dashboard?key=' + token);
      const data = await res.json();
      if (!data.error) setDashboard(data);
    } catch {}
  };

  const fetchUsers = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users?key=' + token);
      const data = await res.json();
      setUsers(data.items || []);
    } catch {} finally { setLoading(false); }
  };

  const fetchCodes = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/codes?key=' + token);
      const data = await res.json();
      setCodes(data.items || []);
    } catch {} finally { setLoading(false); }
  };

  const handleGenCodes = async (count: number, days: number) => {
    const res = await fetch('/api/admin/codes?key=' + token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, days, batch: '后台生成' }),
    });
    const data = await res.json();
    if (data.codes) {
      alert(`生成成功！\n${data.codes.join('\n')}`);
      fetchCodes();
    }
  };

  const handleToggleUser = async (id: number, status: string) => {
    await fetch('/api/admin/users?key=' + token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'toggle_status', status }),
    });
    fetchUsers();
  };

  const handleExtendUser = async (id: number, days: number) => {
    await fetch('/api/admin/users?key=' + token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'extend', days }),
    });
    fetchUsers();
  };

  useEffect(() => {
    if (authed) {
      if (tab === 'stats' || tab === 'match') {
        fetchStats();
        fetchDashboard();
      }
      if (tab === 'users') fetchUsers();
      if (tab === 'codes') fetchCodes();
    }
  }, [tab, authed]);

  // 轮询任务状态
  const pollTask = async () => {
    try {
      const res = await fetch('/api/admin/match-task');
      const data = await res.json();
      setTaskStatus(data.task);
      if (data.task && data.task.status !== 'done') {
        setTimeout(pollTask, 3000);
      } else {
        setTaskPolling(false);
        fetchStats?.();
      }
    } catch {}
  };

  const startMatchTask = async () => {
    if (!confirm('启动全量匹配？只匹配未匹配的记录，已匹配的不动。')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/match-task', { method: 'POST' });
      const data = await res.json();
      if (data.error && data.error !== '已有任务在跑') {
        alert('错误: ' + data.error);
      } else {
        setTaskStatus(data.task);
        setTaskPolling(true);
      }
    } catch (e: any) { alert('错误: ' + e.message); }
    setLoading(false);
  };

  // 登录 - 由 /admin/layout.tsx 统一处理
  if (!authed) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">🎛️ 管理后台</h1>

        {/* Tabs - 5 大类管理菜单 */}
        <div className="mb-6 space-y-3">
          {/* 📊 概览 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/40 mr-2 min-w-[60px]">📊 概览</span>
            <button onClick={() => setTab('stats')}
              className={`px-3 py-1.5 rounded text-sm ${tab === 'stats' ? 'bg-violet-600' : 'bg-white/5 hover:bg-white/10'}`}>
              数据 Dashboard
            </button>
            <a href="/admin/stats-dashboard" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              详细统计
            </a>
          </div>

          {/* 👥 用户 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/40 mr-2 min-w-[60px]">👥 用户</span>
            <button onClick={() => setTab('users')}
              className={`px-3 py-1.5 rounded text-sm ${tab === 'users' ? 'bg-violet-600' : 'bg-white/5 hover:bg-white/10'}`}>
              用户管理
            </button>
            <button onClick={() => setTab('codes')}
              className={`px-3 py-1.5 rounded text-sm ${tab === 'codes' ? 'bg-violet-600' : 'bg-white/5 hover:bg-white/10'}`}>
              卡密生成
            </button>
            <a href="/bounty" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              悬赏专区
            </a>
            <a href="/admin/blacklist" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              黑名单
            </a>
            <a href="/admin/invites" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              🎟️ 邀请码
            </a>
          </div>

          {/* 📥 资源 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/40 mr-2 min-w-[60px]">📥 资源</span>
            <a href="/admin/import" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              导入
            </a>
            <button onClick={() => setTab('match')}
              className={`px-3 py-1.5 rounded text-sm ${tab === 'match' ? 'bg-violet-600' : 'bg-white/5 hover:bg-white/10'}`}>
              TMDB 匹配
            </button>
            <a href="/admin/match-manage" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              匹配管理
            </a>
            <a href="/admin/games" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              游戏管理
            </a>
            <a href="/games" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              游戏中心
            </a>
          </div>

          {/* 📢 对外 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/40 mr-2 min-w-[60px]">📢 对外</span>
            <a href="/admin/publish" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              发布到 TG/QQ
            </a>
            <a href="/admin/tg-organize" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              TG 群整理
            </a>
            <a href="/admin/publish-v2" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              发布历史
            </a>
          </div>

          {/* ⚙️ 系统 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/40 mr-2 min-w-[60px]">⚙️ 系统</span>
            <a href="/admin/pay-config" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              付费配置
            </a>
            <a href="/admin/setup" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              初始化
            </a>
            <a href="/admin/match" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              匹配任务
            </a>
            <a href="/admin/codes" className="px-3 py-1.5 rounded text-sm bg-white/5 hover:bg-white/10 text-white/80 no-underline">
              激活码管理
            </a>
          </div>
        </div>

        {/* Stats */}
        {tab === 'stats' && stats && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-[#12121a] rounded-xl p-4">
                <div className="text-3xl font-bold text-violet-400">{stats.totalResources?.toLocaleString()}</div>
                <div className="text-sm text-white/40 mt-1">总资源数</div>
              </div>
              <div className="bg-[#12121a] rounded-xl p-4">
                <div className="text-3xl font-bold text-green-400">{stats.matchedResources?.toLocaleString()}</div>
                <div className="text-sm text-white/40 mt-1">已匹配</div>
              </div>
              <div className="bg-[#12121a] rounded-xl p-4">
                <div className="text-3xl font-bold text-pink-400">
                  {stats.totalResources && stats.matchedResources ? Math.round(stats.matchedResources / stats.totalResources * 100) : 0}%
                </div>
                <div className="text-sm text-white/40 mt-1">匹配率</div>
              </div>
              <div className="bg-[#12121a] rounded-xl p-4">
                <div className="text-3xl font-bold text-yellow-400">
                  {stats.pendingByCategory?.reduce((a: number, c: any) => a + c.count, 0) || 0}
                </div>
                <div className="text-sm text-white/40 mt-1">待匹配</div>
              </div>
            </div>

            {/* 2026-06-10: 营收 Dashboard */}
            {dashboard && (
              <>
                <div className="mt-6 mb-2 flex items-center gap-2">
                  <span className="text-base font-semibold text-white">💰 营收看板</span>
                  <span className="text-xs text-white/40">实时数据</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-xl p-4">
                    <div className="text-xs text-amber-300 mb-1">💵 总营收 (¥)</div>
                    <div className="text-3xl font-bold text-amber-400">{dashboard.total_revenue.toLocaleString()}</div>
                    <div className="text-xs text-white/40 mt-1">本月 +¥{dashboard.month_revenue.toLocaleString()}</div>
                  </div>
                  <div className="bg-gradient-to-br from-violet-500/10 to-pink-500/10 border border-violet-500/30 rounded-xl p-4">
                    <div className="text-xs text-violet-300 mb-1">🎫 激活码</div>
                    <div className="text-3xl font-bold text-violet-400">{dashboard.total_codes.toLocaleString()}</div>
                    <div className="text-xs text-white/40 mt-1">
                      已用 {dashboard.used_codes} · 未用 {dashboard.unused_codes}
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-xl p-4">
                    <div className="text-xs text-emerald-300 mb-1">👥 用户</div>
                    <div className="text-3xl font-bold text-emerald-400">{dashboard.total_users.toLocaleString()}</div>
                    <div className="text-xs text-white/40 mt-1">
                      VIP {dashboard.vip_active} 活跃 / {dashboard.vip_count} 累计
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-sky-500/10 to-cyan-500/10 border border-sky-500/30 rounded-xl p-4">
                    <div className="text-xs text-sky-300 mb-1">📅 本月</div>
                    <div className="text-3xl font-bold text-sky-400">+{dashboard.month_generated}</div>
                    <div className="text-xs text-white/40 mt-1">
                      生成 {dashboard.month_generated} · 用 {dashboard.month_used}
                    </div>
                  </div>
                </div>

                {/* 渠道分布 */}
                {dashboard.channel_stats.length > 0 && (
                  <div className="bg-[#12121a] rounded-xl p-4 mb-4">
                    <h3 className="text-sm font-semibold mb-3">渠道分布</h3>
                    <div className="space-y-2">
                      {dashboard.channel_stats.slice(0, 8).map((c, i) => (
                        <div key={i} className="flex items-center gap-3 text-sm">
                          <span className="w-16 text-white/60">{c.channel === 'wd' ? '🏪 微店' : c.channel === 'xy' ? '🐟 闲鱼' : c.channel || '-'}</span>
                          <span className="w-20 text-white/60">{c.code_type}</span>
                          <div className="flex-1 bg-white/5 rounded-full h-4 overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-violet-500 to-pink-500 flex items-center pl-2 text-[10px] text-white" style={{ width: dashboard.total_codes > 0 ? `${Math.max(c.total / dashboard.total_codes * 100, 8)}%` : '0%' }}>
                              {c.total}
                            </div>
                          </div>
                          <span className="w-20 text-right text-white/60 text-xs">已用 {c.used}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 续费挽留名单 */}
                {(dashboard.expiring_soon.length > 0 || dashboard.expired.length > 0) && (
                  <div className="bg-[#12121a] rounded-xl p-4 mb-4">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <span>🔔</span> 续费挽留名单
                      <span className="text-xs text-white/40 font-normal">
                        7天内到期 {dashboard.expiring_soon.length} · 已过期 {dashboard.expired.length}
                      </span>
                    </h3>
                    {dashboard.expiring_soon.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs text-amber-300 mb-1.5">⏰ 即将到期 (7天内)</div>
                        <div className="space-y-1">
                          {dashboard.expiring_soon.map(u => (
                            <div key={u.id} className="text-xs flex items-center gap-2">
                              <span className="font-mono text-white/60">#{u.id}</span>
                              <span>{u.username}</span>
                              <span className="text-amber-400 ml-auto">{new Date(u.expire_at).toLocaleDateString('zh-CN')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {dashboard.expired.length > 0 && (
                      <div>
                        <div className="text-xs text-red-300 mb-1.5">⚠️ 已过期</div>
                        <div className="space-y-1">
                          {dashboard.expired.map(u => (
                            <div key={u.id} className="text-xs flex items-center gap-2">
                              <span className="font-mono text-white/60">#{u.id}</span>
                              <span>{u.username}</span>
                              <span className="text-red-400 ml-auto">{new Date(u.expire_at).toLocaleDateString('zh-CN')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Download + User stats */}
            {stats.downloadStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#12121a] rounded-xl p-4">
                  <div className="text-2xl font-bold text-cyan-400">{stats.downloadStats.todayDownloads}</div>
                  <div className="text-sm text-white/40 mt-1">今日下载</div>
                </div>
                <div className="bg-[#12121a] rounded-xl p-4">
                  <div className="text-2xl font-bold text-cyan-400">{stats.downloadStats.totalDownloads}</div>
                  <div className="text-sm text-white/40 mt-1">总下载次数</div>
                </div>
                <div className="bg-[#12121a] rounded-xl p-4">
                  <div className="text-2xl font-bold text-orange-400">{stats.downloadStats.totalUsers}</div>
                  <div className="text-sm text-white/40 mt-1">注册用户</div>
                </div>
                <div className="bg-[#12121a] rounded-xl p-4">
                  <div className="text-2xl font-bold text-orange-400">{stats.downloadStats.activeUsers}</div>
                  <div className="text-sm text-white/40 mt-1">今日活跃</div>
                </div>
              </div>
            )}

            {/* Category breakdown */}
            {stats.pendingByCategory?.length > 0 && (
              <div className="bg-[#12121a] rounded-xl p-4 mt-4">
                <h3 className="text-sm font-semibold text-white/60 mb-3">各分类待匹配</h3>
                <div className="flex flex-wrap gap-2">
                  {stats.pendingByCategory.map((c: any) => (
                    <span key={c.category} className="px-3 py-1 bg-white/5 rounded-lg text-sm">
                      {c.category} <span className="text-yellow-400">{c.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Users */}
        {tab === 'users' && (
          <div>
            <div className="bg-[#12121a] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-3 text-white/40">用户名</th>
                    <th className="text-left p-3 text-white/40">分组</th>
                    <th className="text-left p-3 text-white/40">过期时间</th>
                    <th className="text-left p-3 text-white/40">状态</th>
                    <th className="text-left p-3 text-white/40">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u: any) => (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-3">{u.username}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${u.user_group === 'admin' ? 'bg-red-600' : 'bg-violet-600'}`}>
                          {u.user_group}
                        </span>
                      </td>
                      <td className="p-3 text-white/60">{u.expire_at?.slice(0, 10) || '无'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${u.status === 'active' ? 'bg-green-600' : 'bg-red-600'}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <button onClick={() => handleToggleUser(u.id, u.status)}
                          className="text-xs px-2 py-1 bg-white/10 rounded hover:bg-white/20 mr-1">
                          {u.status === 'active' ? '禁用' : '启用'}
                        </button>
                        <button onClick={() => handleExtendUser(u.id, 30)}
                          className="text-xs px-2 py-1 bg-violet-600/30 rounded hover:bg-violet-600/50">
                          +30天
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <div className="p-8 text-center text-white/40">暂无用户</div>}
            </div>
          </div>
        )}

        {/* Codes */}
        {tab === 'codes' && (
          <div>
            <div className="flex gap-3 mb-4">
              <button onClick={() => handleGenCodes(10, 30)} className="px-4 py-2 bg-violet-600 rounded-lg text-sm hover:opacity-90">生成10个(30天)</button>
              <button onClick={() => handleGenCodes(10, 90)} className="px-4 py-2 bg-pink-600 rounded-lg text-sm hover:opacity-90">生成10个(90天)</button>
              <button onClick={() => handleGenCodes(5, 365)} className="px-4 py-2 bg-yellow-600 rounded-lg text-sm hover:opacity-90">生成5个(1年)</button>
            </div>
            <div className="bg-[#12121a] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-3 text-white/40">卡密</th>
                    <th className="text-left p-3 text-white/40">天数</th>
                    <th className="text-left p-3 text-white/40">状态</th>
                    <th className="text-left p-3 text-white/40">批次</th>
                    <th className="text-left p-3 text-white/40">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c: any) => (
                    <tr key={c.id} className="border-b border-white/5">
                      <td className="p-3 font-mono text-violet-300">{c.code}</td>
                      <td className="p-3">{c.days}天</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${c.status === 'unused' ? 'bg-green-600' : 'bg-white/10'}`}>
                          {c.status === 'unused' ? '可用' : '已用'}
                        </span>
                      </td>
                      <td className="p-3 text-white/60">{c.batch_id}</td>
                      <td className="p-3 text-white/40">{c.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Match */}
        {tab === 'match' && (
          <div className="space-y-4">
            <div className="bg-[#12121a] rounded-xl p-6">
              <h3 className="font-semibold mb-4">🔍 TMDB 匹配管理</h3>
              {stats && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-white/5 rounded-lg p-3">
                    <div className="text-2xl font-bold text-green-400">{stats.matchedResources?.toLocaleString()}</div>
                    <div className="text-xs text-white/40">已匹配</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3">
                    <div className="text-2xl font-bold text-yellow-400">{stats.pendingByCategory?.reduce((a: number, c: any) => a + c.count, 0) || 0}</div>
                    <div className="text-xs text-white/40">待匹配</div>
                  </div>
                </div>
              )}

              {/* 任务进度 */}
              {taskStatus && (
                <div className="mb-4 p-3 bg-white/5 rounded-lg">
                  <div className="flex justify-between text-xs text-white/40 mb-1">
                    <span>{taskStatus.status === 'running' ? '匹配中...' : taskStatus.status === 'done' ? '✅ 完成' : taskStatus.status}</span>
                    <span>{taskStatus.offset ||0}/{taskStatus.total || 0}</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-2">
                    <div className="bg-violet-500 h-2 rounded-full transition-all" style={{ width: taskStatus.total > 0 ? `${Math.round((taskStatus.offset||0) / taskStatus.total * 100)}%` : '0%' }} />
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-green-400">匹配 {taskStatus.matched || 0}</span>
                    <span className="text-red-400">未匹配 {taskStatus.nomatch || 0}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                <button onClick={startMatchTask} disabled={loading || taskPolling}
                  className="px-4 py-2 bg-violet-600 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
                  ▶️ 全量匹配
                </button>
                <a href="/admin/match" className="px-4 py-2 bg-cyan-600 rounded-lg text-sm hover:opacity-90 text-center no-underline">
                  🔍 手动匹配管理
                </a>
                <button onClick={async () => {
                  if (!confirm('确定清空所有 tmdb_id？此操作不可恢复！')) return;
                  setLoading(true);
                  try {
                    const res = await fetch('/api/admin/match-manage', {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'clear_all' }),
                    });
                    const data = await res.json();
                    alert(data.success ? '已清空所有匹配状态' : '失败: ' + data.error);
                    fetchStats();
                    setTaskStatus(null);
                  } catch (e: any) { alert('错误: ' + e.message); }
                  setLoading(false);
                }} className="px-4 py-2 bg-red-600 rounded-lg text-sm hover:opacity-90">
                  🗑️ 清空匹配（重置）
                </button>
              </div>
            </div>
          </div>
        )}


      </div>
    </div>
  );
}