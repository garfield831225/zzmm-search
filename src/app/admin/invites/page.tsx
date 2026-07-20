'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { UserPlus, Plus, RefreshCw, Trash2, Copy, Check, Mail, Calendar, AlertCircle, Download, FileText } from 'lucide-react';

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
  const [genResult, setGenResult] = useState<{ codes: string[]; expires_days: number; inserted?: number; requested?: number } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // 批量选择
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<'copy' | 'export' | 'delete' | null>(null);

  useEffect(() => {
    // 2026-07-20: 统一 token 读取 (token / adminToken / zzmm_token), login + register 两条路径都覆盖
    const t = typeof window !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('adminToken') || localStorage.getItem('zzmm_token') || '') : '';
    if (t) { setToken(t); setAuthed(true); }
  }, []);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg }); setTimeout(() => setToast(null), 2500);
  };

  const fetchList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/admin/invites', {
        credentials: 'include',
        headers: { Authorization: 'Bearer ' + token },
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else {
        setItems(d.items || []);
        setStats(d.stats || { total: 0, used: 0, unused: 0, expired: 0 });
        setSelected(new Set()); // 刷新时清选择
      }
    } catch (e: any) { showToast('error', e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (authed) fetchList(); }, [authed, fetchList]);

  const handleGen = async () => {
    if (!token) return;
    if (genCount < 1 || genCount > 1000) { showToast('error', '数量 1-1000'); return; }
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/invites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ count: genCount, note: genNote, expires_days: genDays }),
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else {
        setGenResult({ codes: d.codes, expires_days: d.expires_days, inserted: d.inserted, requested: d.requested });
        const skipped = (d.requested || 0) - (d.inserted || 0);
        showToast('success', `✅ 生成 ${d.codes.length} 个${skipped > 0 ? ` (跳过 ${skipped} 个重复)` : ''}`);
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

  // 下载文件 (用于导出)
  const downloadFile = (text: string, filename: string, mime: string) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportGenResult = (fmt: 'csv' | 'txt') => {
    if (!genResult) return;
    const ts = new Date().toISOString().slice(0, 10);
    if (fmt === 'csv') {
      const lines = ['code,note,expires_days', ...genResult.codes.map(c => `${c},${(genNote || '').replace(/"/g, '""')},${genResult.expires_days}`)];
      downloadFile(lines.join('\n'), `invite_codes_${ts}.csv`, 'text/csv;charset=utf-8');
    } else {
      downloadFile(genResult.codes.join('\n'), `invite_codes_${ts}.txt`, 'text/plain;charset=utf-8');
    }
    showToast('success', '✅ 已下载');
  };

  // 复制选中 (用 Set)
  const copySelected = () => {
    const codes = items.filter(i => selected.has(i.id)).map(i => i.code);
    if (codes.length === 0) { showToast('error', '未选择'); return; }
    copyText(codes.join('\n'));
  };

  // 导出选中 (前端生成 CSV/TXT, 不调 API)
  const exportSelected = (fmt: 'csv' | 'txt') => {
    const picked = items.filter(i => selected.has(i.id));
    if (picked.length === 0) { showToast('error', '未选择'); return; }
    const ts = new Date().toISOString().slice(0, 10);
    if (fmt === 'csv') {
      const lines = ['code,note,created_at,expires_at,is_used'];
      for (const i of picked) {
        lines.push(`${i.code},"${(i.note || '').replace(/"/g, '""')}",${i.created_at || ''},${i.expires_at || ''},${i.is_used}`);
      }
      downloadFile(lines.join('\n'), `invite_codes_selected_${ts}.csv`, 'text/csv;charset=utf-8');
    } else {
      downloadFile(picked.map(i => i.code).join('\n'), `invite_codes_selected_${ts}.txt`, 'text/plain;charset=utf-8');
    }
    showToast('success', `✅ 已导出 ${picked.length} 个`);
  };

  // 删除选中
  const deleteSelected = async () => {
    if (selected.size === 0) { showToast('error', '未选择'); return; }
    if (!confirm(`确认删除选中的 ${selected.size} 个邀请码？(只删未使用)`)) return;
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      try {
        const r = await fetch(`/api/admin/invites?id=${id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { Authorization: 'Bearer ' + token },
        });
        if (r.ok) ok++; else fail++;
      } catch { fail++; }
    }
    showToast(fail === 0 ? 'success' : 'error', `✅ 删除 ${ok} 个${fail > 0 ? `, 失败 ${fail}` : ''}`);
    fetchList();
  };

  // 全选/反选
  const toggleAll = () => {
    const unused = items.filter(i => !i.is_used);
    if (selected.size === unused.length) setSelected(new Set());
    else setSelected(new Set(unused.map(i => i.id)));
  };

  const deleteOne = async (id: number) => {
    if (!confirm('确认删除这个未使用的邀请码？')) return;
    try {
      const r = await fetch(`/api/admin/invites?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Authorization: 'Bearer ' + token },
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else { showToast('success', '✅ 已删除'); fetchList(); }
    } catch (e: any) { showToast('error', e.message); }
  };

  const cleanupUsed = async () => {
    if (!confirm(`确认清理所有已使用的邀请码？此操作不可恢复。`)) return;
    try {
      const r = await fetch('/api/admin/invites?action=all_unused', {
        method: 'DELETE',
        credentials: 'include',
        headers: { Authorization: 'Bearer ' + token },
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else { showToast('success', `✅ 已清理 ${d.deleted} 条`); fetchList(); }
    } catch (e: any) { showToast('error', e.message); }
  };

  // 登录 - 由 /admin/layout.tsx 统一处理
  if (!authed) return null;

  const unused = items.filter(i => !i.is_used);
  const allSelected = selected.size === unused.length && unused.length > 0;

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
              <label className="block text-xs text-white/60 mb-1.5">数量 (1-1000)</label>
              <input type="number" min={1} max={1000} value={genCount} onChange={e => setGenCount(parseInt(e.target.value) || 1)}
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
                <div className="flex gap-2 flex-wrap">
                  <button onClick={copyAll} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs flex items-center gap-1">
                    <Copy className="w-3 h-3" /> 复制全部
                  </button>
                  <button onClick={() => exportGenResult('txt')} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs flex items-center gap-1">
                    <FileText className="w-3 h-3" /> 下载 .txt
                  </button>
                  <button onClick={() => exportGenResult('csv')} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs flex items-center gap-1">
                    <Download className="w-3 h-3" /> 下载 .csv
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
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Mail className="w-5 h-5 text-emerald-400" /> 邀请码列表 ({items.length})
              {selected.size > 0 && <span className="text-xs text-amber-400">已选 {selected.size}</span>}
            </h2>
            <div className="flex gap-2 flex-wrap">
              {selected.size > 0 && (
                <>
                  <button onClick={copySelected} className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-center gap-1">
                    <Copy className="w-3 h-3" /> 复制选中
                  </button>
                  <button onClick={() => exportSelected('txt')} className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-center gap-1">
                    <FileText className="w-3 h-3" /> 导出 .txt
                  </button>
                  <button onClick={() => exportSelected('csv')} className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-center gap-1">
                    <Download className="w-3 h-3" /> 导出 .csv
                  </button>
                  <button onClick={deleteSelected} className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-xs text-red-300 flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> 删除选中
                  </button>
                </>
              )}
              {stats.used > 0 && (
                <button onClick={cleanupUsed} className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-xs text-red-300">
                  🧹 清理已用 ({stats.used})
                </button>
              )}
            </div>
          </div>
          {items.length === 0 ? (
            <div className="text-center py-12 text-white/40 text-sm">还没生成邀请码</div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#12121a]">
                  <tr className="text-left text-white/40 text-xs border-b border-white/10">
                    <th className="py-2 px-2 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="accent-emerald-500"
                      />
                    </th>
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
                    const isUnused = !i.is_used;
                    const isSelected = selected.has(i.id);
                    return (
                      <tr key={i.id} className={`border-b border-white/5 hover:bg-white/5 ${i.is_used ? 'opacity-60' : ''} ${isSelected ? 'bg-amber-500/5' : ''}`}>
                        <td className="py-2 px-2">
                          {isUnused && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(i.id);
                                else next.delete(i.id);
                                setSelected(next);
                              }}
                              className="accent-amber-500"
                            />
                          )}
                        </td>
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
