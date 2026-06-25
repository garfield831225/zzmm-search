'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Ban, Plus, Trash2, RefreshCw, Shield, AlertCircle } from 'lucide-react';

interface BlacklistItem {
  id: number;
  access_code: string;
  reason: string;
  created_at: string;
  created_by: string;
}

export default function BlacklistPage() {
  const [items, setItems] = useState<BlacklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);

  // 表单
  const [newCode, setNewCode] = useState('');
  const [newReason, setNewReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    const t = typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || '') : '';
    if (t) { setToken(t); setAuthed(true); }
  }, []);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 2500);
  };

  const fetchList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/admin/blacklist', { headers: { Authorization: 'Bearer ' + token } });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else setItems(d.list || []);
    } catch (e: any) { showToast('error', e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (authed) fetchList(); }, [authed, fetchList]);

  const handleAdd = async () => {
    if (!newCode.trim()) { showToast('error', '请输入访问码'); return; }
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ access_code: newCode.trim(), reason: newReason.trim() || '黑名单' }),
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else {
        showToast('success', '✅ 已加入黑名单');
        setNewCode('');
        setNewReason('');
        fetchList();
      }
    } catch (e: any) { showToast('error', e.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number, code: string) => {
    if (!confirm(`确认从黑名单移除「${code}」？`)) return;
    try {
      const r = await fetch('/api/admin/blacklist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else { showToast('success', '✅ 已移除'); fetchList(); }
    } catch (e: any) { showToast('error', e.message); }
  };

  // 登录 - 由 /admin/layout.tsx 统一处理
  if (!authed) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Ban className="w-7 h-7 text-red-400" /> 黑名单管理
          </h1>
          <div className="flex items-center gap-2">
            <button onClick={fetchList} disabled={loading} className="text-sm text-white/40 hover:text-white/80 flex items-center gap-1">
              <RefreshCw className={'w-3 h-3 ' + (loading ? 'animate-spin' : '')} /> 刷新
            </button>
            <button onClick={() => { localStorage.removeItem('zzmm_token'); setAuthed(false); setToken(''); }} className="text-sm text-white/40 hover:text-white/60">
              退出登录
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 flex items-center gap-1"><Shield className="w-3 h-3" /> 总数</div>
            <div className="text-2xl font-bold mt-1">{items.length}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> 最近 7 天</div>
            <div className="text-2xl font-bold mt-1 text-amber-400">{items.filter(i => Date.now() - new Date(i.created_at).getTime() < 7 * 86400000).length}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40">最近添加</div>
            <div className="text-sm mt-1 text-white/60">{items[0] ? new Date(items[0].created_at).toLocaleString('zh-CN') : '-'}</div>
          </div>
        </div>

        {/* 添加表单 */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-[#12121a] rounded-2xl p-6 border border-red-500/20 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-red-400" /> 添加黑名单</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="sm:col-span-1">
              <label className="block text-xs text-white/60 mb-1.5">访问码 / 链接码</label>
              <input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="如 xxx链接码 / 共享码"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm font-mono" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-white/60 mb-1.5">拉黑原因（可选）</label>
              <input value={newReason} onChange={e => setNewReason(e.target.value)} placeholder="如 恶意下载 / 共享滥用 / 测试"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm" />
            </div>
          </div>
          <button onClick={handleAdd} disabled={submitting || !newCode.trim()}
            className="w-full py-2.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium disabled:opacity-30">
            {submitting ? '提交中...' : '➕ 加入黑名单'}
          </button>
        </motion.div>

        {/* 列表 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
          <h2 className="text-lg font-semibold mb-4">📋 黑名单列表（共 {items.length} 条）</h2>
          {items.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-sm">🎉 黑名单为空，没有被封禁的访问码</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/40 text-xs border-b border-white/10">
                    <th className="py-2 px-2">ID</th>
                    <th className="py-2 px-2">访问码</th>
                    <th className="py-2 px-2">原因</th>
                    <th className="py-2 px-2">操作人</th>
                    <th className="py-2 px-2">时间</th>
                    <th className="py-2 px-2 w-20">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(i => (
                    <tr key={i.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-2 text-white/40">#{i.id}</td>
                      <td className="py-2 px-2 font-mono text-red-300 text-xs break-all">{i.access_code}</td>
                      <td className="py-2 px-2 text-white/70 text-xs">{i.reason || '-'}</td>
                      <td className="py-2 px-2 text-xs text-white/60">{i.created_by}</td>
                      <td className="py-2 px-2 text-xs text-white/60">{new Date(i.created_at).toLocaleString('zh-CN')}</td>
                      <td className="py-2 px-2">
                        <button onClick={() => handleDelete(i.id, i.access_code)} className="px-2 py-1 bg-white/5 hover:bg-red-500/20 rounded text-xs text-red-300 flex items-center gap-1">
                          <Trash2 className="w-3 h-3" /> 移除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-lg text-sm z-50 ${
              toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
            }`}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}