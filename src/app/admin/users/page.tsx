'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Users, RefreshCw, ChevronLeft, ChevronRight, ShieldOff, ShieldCheck, Calendar, KeyRound } from 'lucide-react';

interface UserRow {
  id: number;
  username: string;
  user_group: string;
  expire_at: string | null;
  status: string;
  created_at: string;
  last_login: string | null;
  is_verified: boolean;
}

export default function UsersPage() {
  const [items, setItems] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [authed, setAuthed] = useState(false);
  const [token, setToken] = useState('');

  useEffect(() => {
    // 2026-07-20: 统一 token 读取 (token / adminToken / zzmm_token)
    const t = typeof window !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('adminToken') || localStorage.getItem('zzmm_token') || '') : '';
    if (t) { setToken(t); setAuthed(true); }
  }, []);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg }); setTimeout(() => setToast(null), 2500);
  };

  const fetchList = useCallback(async (p?: number) => {
    const targetPage = p ?? page;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const r = await fetch('/api/admin/users?' + params, {
        credentials: 'include',
        headers: { Authorization: 'Bearer ' + token },
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else {
        setItems(d.items || []);
        setTotal(d.total || 0);
        setPage(d.page || targetPage);
      }
    } catch (e: any) { showToast('error', e.message); }
    finally { setLoading(false); }
  }, [token, page, pageSize, search]);

  useEffect(() => { if (authed) fetchList(1); }, [authed, fetchList]);

  const handleSearch = () => {
    setSearch(searchInput);
  };

  const toggleStatus = async (u: UserRow) => {
    const newStatus = u.status === 'active' ? 'banned' : 'active';
    if (!confirm(`${u.username} → ${newStatus === 'banned' ? '🚫 封禁' : '✅ 解封'}?`)) return;
    try {
      const r = await fetch('/api/admin/users', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ id: u.id, action: 'toggle_status', status: u.status }),
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else { showToast('success', `✅ ${u.username} → ${newStatus}`); fetchList(); }
    } catch (e: any) { showToast('error', e.message); }
  };

  const extendUser = async (u: UserRow, days: number) => {
    try {
      const r = await fetch('/api/admin/users', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ id: u.id, action: 'extend', days }),
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else { showToast('success', `✅ ${u.username} 延期到 ${d.new_expire}`); fetchList(); }
    } catch (e: any) { showToast('error', e.message); }
  };

  // 2026-08-09: 重置用户密码, 8 位随机, API 返明文让 admin 复制给用户
  const resetPassword = async (u: UserRow) => {
    if (!confirm(`🔑 重置 ${u.username} 的密码?\n\n新密码为 8 位随机字符串, 重置后请立即告知用户。\n旧密码立即失效, 不可恢复。`)) return;
    try {
      const r = await fetch('/api/admin/users', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ id: u.id, action: 'reset_password' }),
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else {
        // 弹窗显示新密码让 admin 复制 (复制按钮 + 自动选中)
        const textarea = document.createElement('textarea');
        textarea.value = d.new_password;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } catch {}
        document.body.removeChild(textarea);
        alert(`✅ ${u.username} 的新密码:\n\n${d.new_password}\n\n${copied ? '已自动复制, 请粘贴告知用户' : '请手动复制'}\n\n⚠️ 密码不会再次显示`);
      }
    } catch (e: any) { showToast('error', e.message); }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (!authed) {
    return <div className="min-h-screen flex items-center justify-center text-white/40">未登录</div>;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Users className="w-6 h-6 text-fuchsia-400" />
          <h1 className="text-2xl font-bold">用户列表</h1>
          <span className="text-sm text-white/40">共 {total.toLocaleString()} 个</span>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="搜索用户名..."
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-fuchsia-500/50"
          />
          <button onClick={handleSearch} className="px-5 py-2 bg-fuchsia-600/20 hover:bg-fuchsia-600/30 border border-fuchsia-500/30 rounded-lg text-sm">搜索</button>
          <button onClick={() => fetchList()} className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">用户名</th>
                <th className="px-4 py-3 text-left">分组</th>
                <th className="px-4 py-3 text-left">状态</th>
                <th className="px-4 py-3 text-left">到期</th>
                <th className="px-4 py-3 text-left">注册</th>
                <th className="px-4 py-3 text-left">最后登录</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map(u => (
                <tr key={u.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 text-white/40">{u.id}</td>
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      u.user_group === 'admin' ? 'bg-rose-500/20 text-rose-300' :
                      u.user_group === 'vip' ? 'bg-amber-500/20 text-amber-300' :
                      u.user_group === 'basic' ? 'bg-emerald-500/20 text-emerald-300' :
                      'bg-white/10 text-white/60'
                    }`}>
                      {u.user_group}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      u.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                    }`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs">{u.expire_at ? u.expire_at.slice(0, 10) : '永久'}</td>
                  <td className="px-4 py-3 text-white/40 text-xs">{u.created_at ? u.created_at.slice(0, 10) : '-'}</td>
                  <td className="px-4 py-3 text-white/40 text-xs">{u.last_login ? u.last_login.slice(0, 16).replace('T', ' ') : '从未'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleStatus(u)}
                      className={`px-2 py-1 rounded text-xs ${
                        u.status === 'active' ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300' : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300'
                      }`}
                    >
                      {u.status === 'active' ? <><ShieldOff className="w-3 h-3 inline mr-1" />封禁</> : <><ShieldCheck className="w-3 h-3 inline mr-1" />解封</>}
                    </button>
                    <button
                      onClick={() => {
                        const days = prompt(`延期天数 (1-3650):`, '30');
                        const n = parseInt(days || '', 10);
                        if (n > 0 && n <= 3650) extendUser(u, n);
                      }}
                      className="ml-1 px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded text-xs"
                    >
                      <Calendar className="w-3 h-3 inline mr-1" />延期
                    </button>
                    <button
                      onClick={() => resetPassword(u)}
                      className="ml-1 px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 rounded text-xs"
                      title="重置为 8 位随机密码"
                    >
                      <KeyRound className="w-3 h-3 inline mr-1" />重置密码
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-white/40">没有数据</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-white/40">第 {page} / {totalPages} 页</span>
            <div className="flex gap-2">
              <button
                onClick={() => fetchList(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded text-sm flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> 上一页
              </button>
              <button
                onClick={() => fetchList(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded text-sm flex items-center gap-1"
              >
                下一页 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg text-sm font-medium shadow-2xl ${
          toast.type === 'success' ? 'bg-emerald-500/90' : 'bg-rose-500/90'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
