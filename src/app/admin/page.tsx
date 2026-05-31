'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

type Tab = 'stats' | 'users' | 'codes' | 'import' | 'match';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);

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
      if (tab === 'stats' || tab === 'match') fetchStats();
      if (tab === 'users') fetchUsers();
      if (tab === 'codes') fetchCodes();
    }
  }, [tab, authed]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
        <div className="bg-[#12121a] rounded-2xl p-8 w-full max-w-sm border border-white/5">
          <h2 className="text-xl font-bold mb-6 text-center">管理后台登录</h2>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="输入管理员密钥"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 mb-4"
          />
          <button
            onClick={() => { localStorage.setItem('adminToken', token); setAuthed(true); }}
            className="w-full py-3 bg-violet-600 rounded-xl font-semibold hover:opacity-90"
          >
            进入后台
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">🎛️ 管理后台</h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {(['stats', 'users', 'codes', 'import', 'match'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm ${tab === t ? 'bg-violet-600' : 'bg-white/5 hover:bg-white/10'}`}>
              {{ stats: '📊 数据', users: '👥 用户', codes: '🎫 卡密', import: '📥 导入', match: '🔍 匹配' }[t]}
            </button>
          ))}
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
              <div className="flex gap-3 flex-wrap">
                <a href="/admin/match" className="px-4 py-2 bg-violet-600 rounded-lg text-sm hover:opacity-90 text-center no-underline">
                  🔍 匹配管理（手动/搜索绑定）
                </a>
             </div>
              <div className="mt-4 p-3 bg-white/5 rounded-lg text-sm">
                <div className="font-semibold text-yellow-400 mb-2">⚠️ 全量匹配操作说明</div>
                <div className="text-white/60 text-xs space-y-1">
                  <div>1. <b>重置</b>：先点下方「清空匹配状态」，清除所有 tmdb_id</div>
                  <div>2. <b>匹配</b>：本地执行<code className="bg-white/10 px-1 rounded">node scripts/match-parallel.mjs</code></div>
                  <div>3. <b>查看</b>：匹配管理页查看进度和结果</div>
               </div>
              </div>
              <div className="flex gap-3 mt-4">
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
                  } catch (e: any) { alert('错误: ' + e.message); }
                  setLoading(false);
                }} className="px-4 py-2 bg-red-600 rounded-lg text-sm hover:opacity-90">
                  🗑️ 清空匹配状态（重置）
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Import */}
        {tab === 'import' && (
          <div className="bg-[#12121a] rounded-xl p-6">
            <h3 className="font-semibold mb-4">📥 Excel 批量导入</h3>
            <p className="text-sm text-white/60 mb-4">通过 /api/admin/import 导入，格式：{`{items: [{name, link, link_code, category, size}]}`}</p>
            <div className="p-4 bg-white/5 rounded-lg text-sm font-mono text-white/60">
              POST /api/admin/import<br />
              Header: Authorization: Bearer {"<JWT>"}<br />
              Body: {"{ items: [...] }"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}