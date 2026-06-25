'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { UserPlus, Plus, RefreshCw, Trash2, Copy, Check, Mail, Calendar, AlertCircle } from 'lucide-react';

interface InviteCode {
  id: number;
  code: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  used_by: number | null;
  used_by_username: string | null;
  used_at: string | null;
  expires_at: string | null;
  is_used: boolean;
}

export default function InvitesPage() {
  const [items, setItems] = useState<InviteCode[]>([]);
  const [stats, setStats] = useState({ total: 0, used: 0, unused: 0, expired: 0 });
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);

  const [genCount, setGenCount] = useState(10);
  const [genNote, setGenNote] = useState('');
  const [genDays, setGenDays] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [genResult, setGenResult] = useState<{ codes: string[]; expires_days: number } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    const t = typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || '') : '';
    if (t) { setToken(t); setAuthed(true); }
  }, []);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg }); setTimeout(() => setToast(null), 2500);
  };

  const fetchList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/admin/invites', { headers: { Authorization: 'Bearer ' + token } });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else {
        setItems(d.items || []);
        setStats(d.stats || { total: 0, used: 0, unused: 0, expired: 0 });
      }
    } catch (e: any) { showToast('error', e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (authed) fetchList(); }, [authed, fetchList]);

  const handleGen = async () => {
    if (!token) return;
    if (genCount < 1 || genCount > 500) { showToast('error', '数量 1-500'); return; }
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ count: genCount, note: genNote, expires_days: genDays }),
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else {
        setGenResult({ codes: d.codes, expires_days: d.expires_days });
        showToast('success', `✅ 生成 ${d.codes.length} 个邀请码`);
        fetchList();
      }
    } catch (e: any) { showToast('error', e.message); }
    finally { setSubmitting(false); }
  };

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); showToast('success', '✅ 已复制'); }
    catch { showToast('error', '复制失败'); }
  };

  const copyAll = () => {
    if (!genResult) return;
    copyText(genResult.codes.join('\n'));
  };

  const deleteOne = async (id: number) => {
    if (!confirm('确认删除这个未使用的邀请码？')) return;
    try {
      const r = await fetch(`/api/admin/invites?id=${id}`, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else { showToast('success', '✅ 已删除'); fetchList(); }
    } catch (e: any) { showToast('error', e.message); }
  };

  const cleanupUsed = async () => {
    if (!confirm(`确认清理所有已使用的邀请码？此操作不可恢复。`)) return;
    try {
      const r = await fetch('/api/admin/invites', {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else { showToast('success', `✅ 已清理 ${d.deleted} 条`); fetchList(); }
    } catch (e: any) { showToast('error', e.message); }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#12121a] rounded-2xl p-6 border border-white/10">
          <h1 className="text-2xl font-bold mb-2 flex items-center gap-2"><UserPlus className="w-6 h-6 text-emerald-400" /> 邀请码管理</h1>
          <p className="text-sm text-white/40 mb-4">一次性邀请码 · 用户注册时必须输入</p>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="粘贴你的 zzmm_token"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50" />
          <button onClick={() => { if (token) { localStorage.setItem('zzmm_token', token); setAuthed(true); } }} disabled={!token}
            className="w-full mt-4 py-3 bg-emerald-600 rounded-xl hover:opacity-90 disabled:opacity-50 font-medium">
            进入管理
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <UserPlus className="w-7 h-7 text-emerald-400" /> 邀请码管理
          </h1>
          <div className="flex items-center gap-2">
            <Link href="/admin" className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm">← 返回</Link>
            <button onClick={fetchList} disabled={loading} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm flex items-center gap-1">
              <RefreshCw className={'w-3 h-3 ' + (loading ? 'animate-spin' : '')} /> 刷新
            </button>
          </div>
        </div>

        {/* 统计 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 flex items-center gap-1"><Mail className="w-3 h-3" /> 总数</div>
            <div className="text-2xl font-bold mt-1">{stats.total}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40">未使用</div>
            <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.unused}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40">已使用</div>
            <div className="text-2xl font-bold mt-1 text-amber-400">{stats.used}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40">已过期</div>
            <div className="text-2xl font-bold mt-1 text-red-400">{stats.expired}</div>
          </div>
        </div>

        {/* 生成器 */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-[#12121a] rounded-2xl p-6 border border-emerald-500/20 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-emerald-400" /> 批量生成邀请码</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-xs text-white/60 mb-1.5">数量 (1-500)</label>
              <input type="number" min={1} max={500} value={genCount} onChange={e => setGenCount(parseInt(e.target.value) || 1)}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1.5">有效天数</label>
              <input type="number" min={1} max={365} value={genDays} onChange={e => setGenDays(parseInt(e.target.value) || 30)}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1.5">备注 (可选)</label>
              <input value={genNote} onChange={e => setGenNote(e.target.value)} placeholder="如: 闲鱼 6月批次"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm" />
            </div>
          </div>
          <button onClick={handleGen} disabled={submitting}
            className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl font-medium hover:opacity-90 disabled:opacity-50">
            {submitting ? '生成中...' : `🎟️ 生成 ${genCount} 个邀请码 (${genDays}天有效)`}
          </button>

          {/* 生成结果 */}
          {genResult && (
            <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="text-sm">
                  <span className="text-emerald-400 font-semibold">✅ 已生成 {genResult.codes.length} 个</span>
                  <span className="text-white/60 ml-2">有效 {genResult.expires_days} 天</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={copyAll} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs flex items-center gap-1">
                    <Copy className="w-3 h-3" /> 复制全部
                  </button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto bg-black/30 rounded-lg p-3 font-mono text-xs space-y-0.5">
                {genResult.codes.map(c => (
                  <div key={c} className="text-emerald-300 cursor-pointer hover:text-emerald-200" onClick={() => copyText(c)}>
                    {c}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        {/* 列表 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Mail className="w-5 h-5 text-emerald-400" /> 邀请码列表 ({items.length})
            </h2>
            {stats.used > 0 && (
              <button onClick={cleanupUsed} className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-xs text-red-300">
                🧹 清理已用 ({stats.used})
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-sm">还没生成邀请码</div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#12121a]">
                  <tr className="text-left text-white/40 text-xs border-b border-white/10">
                    <th className="py-2 px-2">邀请码</th>
                    <th className="py-2 px-2">备注</th>
                    <th className="py-2 px-2">状态</th>
                    <th className="py-2 px-2">使用者</th>
                    <th className="py-2 px-2">使用时间</th>
                    <th className="py-2 px-2">过期时间</th>
                    <th className="py-2 px-2 w-20">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(i => {
                    const expired = i.expires_at && new Date(i.expires_at) < new Date() && !i.is_used;
                    return (
                      <tr key={i.id} className={`border-b border-white/5 hover:bg-white/5 ${i.is_used ? 'opacity-60' : ''}`}>
                        <td className="py-2 px-2 font-mono text-emerald-300 cursor-pointer" onClick={() => copyText(i.code)}>
                          {i.code}
                        </td>
                        <td className="py-2 px-2 text-xs text-white/60">{i.note || '-'}</td>
                        <td className="py-2 px-2">
                          {i.is_used ? (
                            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded text-xs">已用</span>
                          ) : expired ? (
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-300 rounded text-xs">过期</span>
                          ) : (
                            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-xs">可用</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-xs">{i.used_by_username || '-'}</td>
                        <td className="py-2 px-2 text-xs text-white/60">{i.used_at ? new Date(i.used_at).toLocaleString('zh-CN') : '-'}</td>
                        <td className="py-2 px-2 text-xs text-white/60">{i.expires_at ? new Date(i.expires_at).toLocaleDateString('zh-CN') : '永久'}</td>
                        <td className="py-2 px-2">
                          {!i.is_used && (
                            <button onClick={() => deleteOne(i.id)} className="px-2 py-1 bg-white/5 hover:bg-red-500/20 rounded text-xs text-red-300 flex items-center gap-1">
                              <Trash2 className="w-3 h-3" /> 删
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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